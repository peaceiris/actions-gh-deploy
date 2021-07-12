import {context} from '@actions/github';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as github from '@actions/github';
import {Inputs} from './interfaces';
import {showInputs, getInputs} from './get-inputs';
import {setTokens} from './set-tokens';
import {setRepo, setCommitAuthor, getCommitMessage, commit, push, pushTag} from './git-utils';
import {getWorkDirName, addNoJekyll, addCNAME, skipOnFork} from './utils';

export async function run(): Promise<void> {
  try {
    core.info('[INFO] Usage https://github.com/peaceiris/actions-gh-pages#readme');

    const inps: Inputs = getInputs();
    core.startGroup('Dump inputs');
    showInputs(inps);
    core.endGroup();

    if (core.isDebug()) {
      core.startGroup('Debug: dump context');
      console.log(context);
      core.endGroup();
    }

    const eventName = context.eventName;
    if (eventName === 'pull_request' || eventName === 'push') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isForkRepository = (context.payload as any).repository.fork;
      const isSkipOnFork = await skipOnFork(
        isForkRepository,
        inps.GithubToken,
        inps.DeployKey,
        inps.PersonalToken
      );
      if (isSkipOnFork) {
        core.warning('This action runs on a fork and not found auth token, Skip deployment');
        core.setOutput('skip', 'true');
        return;
      }
    }

    core.startGroup('Setup auth token');
    const remoteURL = await setTokens(inps);
    core.debug(`remoteURL: ${remoteURL}`);
    core.endGroup();

    core.startGroup('Prepare publishing assets');
    const date = new Date();
    const unixTime = date.getTime();
    const workDir = await getWorkDirName(`${unixTime}`);
    await setRepo(inps, remoteURL, workDir);
    await addNoJekyll(workDir, inps.DisableNoJekyll);
    await addCNAME(workDir, inps.CNAME);
    core.endGroup();

    core.startGroup('Setup Git config');
    try {
      await exec.exec('git', ['remote', 'rm', 'origin']);
    } catch (e) {
      core.info(`[INFO] ${e.message}`);
    }
    await exec.exec('git', ['remote', 'add', 'origin', remoteURL]);
    await exec.exec('git', ['add', '--all']);
    await setCommitAuthor(inps.UserName, inps.UserEmail);
    core.endGroup();

    core.startGroup('Create a commit');
    const hash = `${process.env.GITHUB_SHA}`;
    const baseRepo = `${github.context.repo.owner}/${github.context.repo.repo}`;
    const commitMessage = getCommitMessage(
      inps.CommitMessage,
      inps.FullCommitMessage,
      inps.ExternalRepository,
      baseRepo,
      hash
    );
    const dstSHA = await commit(inps.AllowEmptyCommit, commitMessage);
    core.setOutput('dst_sha', dstSHA);
    core.endGroup();

    core.startGroup('Push the commit or tag');
    await push(inps.PublishBranch, inps.ForceOrphan);
    await pushTag(inps.TagName, inps.TagMessage);
    core.endGroup();

    core.info('[INFO] Action successfully completed');

    return;
  } catch (e) {
    throw new Error(e.message);
  }
}
