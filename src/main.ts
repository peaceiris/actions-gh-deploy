import {context} from '@actions/github';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {Inputs} from './interfaces';
import {showInputs, getInputs} from './get-inputs';
import {setTokens} from './set-tokens';
import {setRepo, setCommitAuthor, commit, push, pushTag} from './git-utils';
import {getWorkDirName, addNoJekyll, addCNAME, skipOnFork} from './utils';

export async function run(): Promise<void> {
  try {
    const inps: Inputs = getInputs();
    showInputs(inps);

    if (core.isDebug()) {
      console.log(context);
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
        core.warning(
          'This action runs on a fork and not found auth token, Skip deployment'
        );
        return;
      }
    }

    const remoteURL = await setTokens(inps);
    core.debug(`remoteURL: ${remoteURL}`);

    const date = new Date();
    const unixTime = date.getTime();
    const workDir = await getWorkDirName(`${unixTime}`);
    await setRepo(inps, remoteURL, workDir);

    await addNoJekyll(workDir, inps.DisableNoJekyll, inps.PublishBranch);
    await addCNAME(workDir, inps.CNAME);

    try {
      await exec.exec('git', ['remote', 'rm', 'origin']);
    } catch (e) {
      core.info(`[INFO] ${e.message}`);
    }
    await exec.exec('git', ['remote', 'add', 'origin', remoteURL]);
    await exec.exec('git', ['add', '--all']);
    await setCommitAuthor(inps.UserName, inps.UserEmail);
    await commit(
      inps.AllowEmptyCommit,
      inps.ExternalRepository,
      inps.CommitMessage
    );
    await push(inps.PublishBranch, inps.ForceOrphan);
    await pushTag(inps.TagName, inps.TagMessage);

    core.info('[INFO] Action successfully completed');

    return;
  } catch (e) {
    throw new Error(e.message);
  }
}
