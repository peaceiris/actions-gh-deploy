import * as core from '@actions/core';
import * as exec from '@actions/exec';
import {Inputs} from './interfaces';
import {getInputs} from './get-inputs';
import {setTokens} from './set-tokens';
import * as git from './git-utils';

export async function run(): Promise<void> {
  try {
    const inps: Inputs = getInputs();

    await git.setConfig(inps.UserName, inps.UserEmail);

    const remoteURL = await setTokens(inps);
    core.debug(`[INFO] remoteURL: ${remoteURL}`);

    const firstDeployment = await git.setRepo(inps, remoteURL);

    try {
      await exec.exec('git', ['remote', 'rm', 'origin']);
    } catch (e) {
      core.info(`[INFO] e`);
    }
    await exec.exec('git', ['remote', 'add', 'origin', remoteURL]);
    await exec.exec('git', ['add', '--all']);

    let allowEmptyCommit = false;
    if (firstDeployment) {
      allowEmptyCommit = true;
    } else {
      allowEmptyCommit = inps.AllowEmptyCommit;
    }
    await git.commit(
      allowEmptyCommit,
      inps.ExternalRepository,
      inps.CommitMessage
    );

    await git.push(inps.PublishBranch, inps.ForceOrphan);
    await git.pushTag(inps.TagName, inps.TagMessage);
    core.info('[INFO] successfully deployed');

    return;
  } catch (e) {
    throw new Error(e);
  }
}
