import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import * as io from '@actions/io';
import * as glob from '@actions/glob';
import path from 'path';
import {Inputs, CmdResult} from './interfaces';
import {getHomeDir} from './utils';

export async function createWorkDir(workDirName: string): Promise<void> {
  await io.mkdirP(workDirName);
  core.debug(`workDir was created: ${workDirName}`);
  return;
}

export async function createBranchForce(branch: string): Promise<void> {
  await exec.exec('git', ['init']);
  await exec.exec('git', ['checkout', '--orphan', branch]);
  return;
}

export async function copyAssets(
  publishDir: string,
  workDir: string
): Promise<void> {
  const copyOpts = {recursive: true, force: false};
  const globber = await glob.create(`${publishDir}/*`);
  for await (const file of globber.globGenerator()) {
    if (file.endsWith('.git') || file.endsWith('.github')) {
      continue;
    }
    await io.cp(file, `${workDir}/`, copyOpts);
    core.info(`[INFO] copy ${file}`);
  }

  return;
}

export async function setRepo(inps: Inputs, remoteURL: string): Promise<void> {
  const workDir = path.join(getHomeDir(), 'actions_github_pages');
  const publishDir = path.join(
    `${process.env.GITHUB_WORKSPACE}`,
    inps.PublishDir
  );

  core.info(`[INFO] ForceOrphan: ${inps.ForceOrphan}`);
  if (inps.ForceOrphan) {
    await createWorkDir(workDir);
    process.chdir(workDir);
    await createBranchForce(inps.PublishBranch);
    await copyAssets(publishDir, workDir);
    return;
  }

  const result: CmdResult = {
    exitcode: 0,
    output: ''
  };
  const options = {
    listeners: {
      stdout: (data: Buffer): void => {
        result.output += data.toString();
      }
    }
  };
  result.exitcode = await exec.exec(
    'git',
    [
      'clone',
      '--depth=1',
      '--single-branch',
      '--branch',
      inps.PublishBranch,
      remoteURL,
      workDir
    ],
    options
  );

  process.chdir(workDir);

  if (result.exitcode === 0) {
    if (inps.KeepFiles) {
      core.info('[INFO] Keep existing files');
    } else {
      await exec.exec('git', ['rm', '-r', '--ignore-unmatch', '*']);
    }

    await copyAssets(publishDir, workDir);
    return;
  } else {
    core.info(
      `[INFO] first deployment, create new branch ${inps.PublishBranch}`
    );
    await createWorkDir(workDir);
    await createBranchForce(inps.PublishBranch);
    await copyAssets(publishDir, workDir);
    return;
  }
}

export async function setConfig(
  userName: string,
  userEmail: string
): Promise<void> {
  await exec.exec('git', ['config', '--global', 'gc.auto', '0']);

  let name = '';
  if (userName) {
    name = userName;
  } else {
    name = `${process.env.GITHUB_ACTOR}`;
  }
  await exec.exec('git', ['config', '--global', 'user.name', name]);

  let email = '';
  if (userName !== '' && userEmail !== '') {
    email = userEmail;
  } else {
    email = `${process.env.GITHUB_ACTOR}@users.noreply.github.com`;
  }
  await exec.exec('git', ['config', '--global', 'user.email', email]);

  return;
}

export async function commit(
  allowEmptyCommit: boolean,
  externalRepository: string,
  message: string
): Promise<void> {
  let msg = '';
  if (message) {
    msg = message;
  } else {
    msg = 'deploy:';
  }

  const hash = `${process.env.GITHUB_SHA}`;
  const baseRepo = `${github.context.repo.owner}/${github.context.repo.repo}`;
  if (externalRepository) {
    msg = `${msg} ${baseRepo}@${hash}`;
  } else {
    msg = `${msg} ${hash}`;
  }

  try {
    if (allowEmptyCommit) {
      await exec.exec('git', ['commit', '--allow-empty', '-m', `${msg}`]);
    } else {
      await exec.exec('git', ['commit', '-m', `${msg}`]);
    }
  } catch (e) {
    core.info('[INFO] skip commit');
    core.debug(`[INFO] skip commit ${e}`);
  }
}

export async function push(
  branch: string,
  forceOrphan: boolean
): Promise<void> {
  if (forceOrphan) {
    await exec.exec('git', ['push', 'origin', '--force', branch]);
  } else {
    await exec.exec('git', ['push', 'origin', branch]);
  }
}

export async function pushTag(
  tagName: string,
  tagMessage: string
): Promise<void> {
  if (tagName === '') {
    return;
  }

  let msg = '';
  if (tagMessage) {
    msg = tagMessage;
  } else {
    msg = `Deployment ${tagName}`;
  }

  await exec.exec('git', ['tag', '-a', `${tagName}`, '-m', `${msg}`]);
  await exec.exec('git', ['push', 'origin', `${tagName}`]);
}
