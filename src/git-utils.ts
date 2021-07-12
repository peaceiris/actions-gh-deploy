import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as glob from '@actions/glob';
import path from 'path';
import fs from 'fs';
import {URL} from 'url';
import {Inputs, CmdResult} from './interfaces';
import {createDir} from './utils';
import {cp, rm} from 'shelljs';

export async function createBranchForce(branch: string): Promise<void> {
  await exec.exec('git', ['init']);
  await exec.exec('git', ['checkout', '--orphan', branch]);
  return;
}

export function getServerUrl(): URL {
  return new URL(process.env['GITHUB_SERVER_URL'] || 'https://github.com');
}

export async function deleteExcludedAssets(destDir: string, excludeAssets: string): Promise<void> {
  if (excludeAssets === '') return;
  core.info(`[INFO] delete excluded assets`);
  const excludedAssetNames: Array<string> = excludeAssets.split(',');
  const excludedAssetPaths = ((): Array<string> => {
    const paths: Array<string> = [];
    for (const pattern of excludedAssetNames) {
      paths.push(path.join(destDir, pattern));
    }
    return paths;
  })();
  const globber = await glob.create(excludedAssetPaths.join('\n'));
  const files = await globber.glob();
  for await (const file of globber.globGenerator()) {
    core.info(`[INFO] delete ${file}`);
  }
  rm('-rf', files);
  return;
}

export async function copyAssets(
  publishDir: string,
  destDir: string,
  excludeAssets: string
): Promise<void> {
  core.info(`[INFO] prepare publishing assets`);

  if (!fs.existsSync(destDir)) {
    core.info(`[INFO] create ${destDir}`);
    await createDir(destDir);
  }

  const dotGitPath = path.join(publishDir, '.git');
  if (fs.existsSync(dotGitPath)) {
    core.info(`[INFO] delete ${dotGitPath}`);
    rm('-rf', dotGitPath);
  }

  core.info(`[INFO] copy ${publishDir} to ${destDir}`);
  cp('-RfL', [`${publishDir}/*`, `${publishDir}/.*`], destDir);

  await deleteExcludedAssets(destDir, excludeAssets);

  return;
}

export async function setRepo(inps: Inputs, remoteURL: string, workDir: string): Promise<void> {
  const publishDir = path.isAbsolute(inps.PublishDir)
    ? inps.PublishDir
    : path.join(`${process.env.GITHUB_WORKSPACE}`, inps.PublishDir);

  if (path.isAbsolute(inps.DestinationDir)) {
    throw new Error('destination_dir should be a relative path');
  }
  const destDir = ((): string => {
    if (inps.DestinationDir === '') {
      return workDir;
    } else {
      return path.join(workDir, inps.DestinationDir);
    }
  })();

  core.info(`[INFO] ForceOrphan: ${inps.ForceOrphan}`);
  if (inps.ForceOrphan) {
    await createDir(destDir);
    core.info(`[INFO] chdir ${workDir}`);
    process.chdir(workDir);
    await createBranchForce(inps.PublishBranch);
    await copyAssets(publishDir, destDir, inps.ExcludeAssets);
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

  try {
    result.exitcode = await exec.exec(
      'git',
      ['clone', '--depth=1', '--single-branch', '--branch', inps.PublishBranch, remoteURL, workDir],
      options
    );
    if (result.exitcode === 0) {
      await createDir(destDir);

      if (inps.KeepFiles) {
        core.info('[INFO] Keep existing files');
      } else {
        core.info(`[INFO] clean up ${destDir}`);
        core.info(`[INFO] chdir ${destDir}`);
        process.chdir(destDir);
        await exec.exec('git', ['rm', '-r', '--ignore-unmatch', '*']);
      }

      core.info(`[INFO] chdir ${workDir}`);
      process.chdir(workDir);
      await copyAssets(publishDir, destDir, inps.ExcludeAssets);
      return;
    } else {
      throw new Error(`Failed to clone remote branch ${inps.PublishBranch}`);
    }
  } catch (e) {
    core.info(`[INFO] first deployment, create new branch ${inps.PublishBranch}`);
    core.info(`[INFO] ${e.message}`);
    await createDir(destDir);
    core.info(`[INFO] chdir ${workDir}`);
    process.chdir(workDir);
    await createBranchForce(inps.PublishBranch);
    await copyAssets(publishDir, destDir, inps.ExcludeAssets);
    return;
  }
}

export function getUserName(userName: string): string {
  if (userName) {
    return userName;
  } else {
    return `${process.env.GITHUB_ACTOR}`;
  }
}

export function getUserEmail(userEmail: string): string {
  if (userEmail) {
    return userEmail;
  } else {
    return `${process.env.GITHUB_ACTOR}@users.noreply.github.com`;
  }
}

export async function setCommitAuthor(userName: string, userEmail: string): Promise<void> {
  if (userName && !userEmail) {
    throw new Error('user_email is undefined');
  }
  if (!userName && userEmail) {
    throw new Error('user_name is undefined');
  }
  await exec.exec('git', ['config', 'user.name', getUserName(userName)]);
  await exec.exec('git', ['config', 'user.email', getUserEmail(userEmail)]);
}

export function getCommitMessage(
  msg: string,
  fullMsg: string,
  extRepo: string,
  baseRepo: string,
  hash: string
): string {
  const msgHash = ((): string => {
    if (extRepo) {
      return `${baseRepo}@${hash}`;
    } else {
      return hash;
    }
  })();

  const subject = ((): string => {
    if (fullMsg) {
      return fullMsg;
    } else if (msg) {
      return `${msg} ${msgHash}`;
    } else {
      return `deploy: ${msgHash}`;
    }
  })();

  return subject;
}

export async function commit(allowEmptyCommit: boolean, msg: string): Promise<string> {
  try {
    if (allowEmptyCommit) {
      await exec.exec('git', ['commit', '--allow-empty', '-m', `${msg}`]);
    } else {
      await exec.exec('git', ['commit', '-m', `${msg}`]);
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
    result.exitcode = await exec.exec('git', ['rev-parse', 'HEAD'], options);

    return result.output;
  } catch (e) {
    core.info('[INFO] skip commit');
    core.debug(`[INFO] skip commit ${e.message}`);
    return '';
  }
}

export async function push(branch: string, forceOrphan: boolean): Promise<void> {
  if (forceOrphan) {
    await exec.exec('git', ['push', 'origin', '--force', branch]);
  } else {
    await exec.exec('git', ['push', 'origin', branch]);
  }
}

export async function pushTag(tagName: string, tagMessage: string): Promise<void> {
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
