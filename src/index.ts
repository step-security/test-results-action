import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

import * as core from '@actions/core';
import * as exec from '@actions/exec';

import {
  buildDownloadOptions,
  buildExecutionOptions,
} from './buildExec';
import {
  isTrue,
  getBaseUrl,
  setFailure,
  getCommand,
} from './helpers';

import verify from './validate';
import versionInfo from './version';
import axios, {isAxiosError} from 'axios';

/**
 * Validates the StepSecurity subscription for private repositories.
 */
async function validateSubscription() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let repoPrivate: boolean | undefined;

  if (eventPath && fs.existsSync(eventPath)) {
    const eventData = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    repoPrivate = eventData?.repository?.private;
  }

  const upstream = 'codecov/test-results-action';
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';

  core.info('');
  core.info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) {
    core.info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
  }
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info('');

  if (repoPrivate === false) return;

  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body: Record<string, string> = {action: action || ''};
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl;
  try {
    await axios.post(
        `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
        body, {timeout: 3000},
    );
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
          '\u001b[1;31mThis action requires a StepSecurity' +
          ' subscription for private repositories.\u001b[0m',
      );
      core.error(
          `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`,
      );
      process.exit(1);
    }
    core.info('Timeout or API not reachable. Continuing to next step.');
  }
}

const invokeCLI = async (
    filename: string,
    failCi: boolean,
    verbose: boolean,
) => {
  const {generalArgs, uploadCommand, uploadExecArgs, executionEnvironment} =
    await buildExecutionOptions(failCi, verbose);

  const doUploadTestResults = async () => {
    await exec.exec(
        getCommand(filename, generalArgs, uploadCommand).join(' '),
        uploadExecArgs,
        executionEnvironment,
    );
  };


  const runCmd = async (fn: () => Promise<void>, fnName: string) => {
    await fn().catch(
        (err: Error) => {
          setFailure(
              `Codecov: Failed to properly ${fnName}: ${err.message}`,
              failCi,
          );
        },
    );
  };

  const runCommands = async () => {
    await runCmd(doUploadTestResults, 'upload report');
  };

  await runCommands();
};

const downloadAndInvokeCLI = (failCi: boolean, verbose: boolean) => {
  const {platform, uploaderName, uploaderVersion} = buildDownloadOptions();
  const filename = path.join(__dirname, uploaderName);

  https.get(getBaseUrl(platform, uploaderVersion), (res) => {
    const filePath = fs.createWriteStream(filename);
    res.pipe(filePath);
    filePath
        .on('error', (err) => {
          setFailure(
              `Codecov: Failed to write uploader binary: ${err.message}`,
              true,
          );
        }).on('finish', async () => {
          filePath.close();

          const verified = await verify(
              filename, platform, uploaderVersion, verbose, failCi,
          );
          if (!verified) return;

          await versionInfo(platform, uploaderVersion);
          fs.chmodSync(filename, '755');

          const unlink = () => {
            fs.unlink(filename, (err) => {
              if (err) {
                setFailure(
                    `Codecov: Could not unlink uploader: ${err.message}`,
                    failCi,
                );
              }
            });
          };

          await invokeCLI(filename, failCi, verbose);
          unlink();
        });
  });
};

(async () => {
  await validateSubscription();
  const failCi = isTrue(core.getInput('fail_ci_if_error'));
  try {
    core.warning(
        `This action is being deprecated in favor of 'codecov-action'.
      Please update CI accordingly to use 'codecov-action@v5' with
      'report_type: test_results'.
      The 'codecov-action' should and can be run at least once for
      coverage and once for test results`,
    );

    const binaryPath = core.getInput('binary');
    const verbose = isTrue(core.getInput('verbose'));

    if (binaryPath) {
      invokeCLI(binaryPath, failCi, verbose).catch((err) => {
        setFailure(
            `Codecov: Encountered an unexpected error ${err.message}`,
            failCi,
        );
      });
    } else {
      downloadAndInvokeCLI(failCi, verbose);
    }
  } catch (err) {
    setFailure(
        `Codecov: Encountered an unexpected error ${(err as Error).message}`,
        failCi,
    );
  }
})();
