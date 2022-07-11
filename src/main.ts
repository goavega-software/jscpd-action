import * as core from '@actions/core';
import * as github from '@actions/github';
import {Context} from '@actions/github/lib/context';
import {GitHub} from '@actions/github/lib/utils';

const gql = (s: TemplateStringsArray): string => s.join('');

async function getOrAddCheck(
  octokit: InstanceType<typeof GitHub>,
  context: Context,
  currentSha: string,
  postAs: string
): Promise<number> {
  let checkId;

  if (postAs) {
    const checks = await octokit.rest.checks.listForRef({
      ...context.repo,
      status: 'in_progress',
      ref: currentSha
    });
    const theCheck = checks.data.check_runs.find(
      ({name}: {name: string}) => name === postAs
    );
    if (theCheck) checkId = theCheck.id;
  }
  if (!checkId) {
    checkId = (
      await octokit.rest.checks.create({
        ...context.repo,
        name: postAs,
        head_sha: currentSha,
        status: 'in_progress',
        started_at: new Date().toISOString()
      })
    ).data.id;
  }
  return checkId;
}

async function completeCheck(
  checkId: number,
  octokit: InstanceType<typeof GitHub>,
  context: Context,
  conclusion: string,
  output: string
): Promise<void> {
  await octokit.rest.checks.update({
    ...context.repo,
    check_run_id: checkId,
    status: 'completed',
    completed_at: new Date().toISOString(),
    conclusion,
    output
  });
}

async function run(): Promise<void> {
  try {
    const secret = core.getInput('secret');
    if (!secret) {
      core.debug('No secret provided');
      return;
    }
    const postAs = core.getInput('post-as') || 'jscpd';
    const octokit = github.getOctokit(secret);
    const context = github.context;

    const prInfo: {
      repository: {
        pullRequest: {
          commits: {
            nodes: {commit: {oid: string}}[];
          };
          files: {
            nodes: {path: string}[];
          };
        };
      };
    } = await octokit.graphql(
      gql`
        query ($owner: String!, $name: String!, $prNumber: Int!) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $prNumber) {
              files(first: 100) {
                nodes {
                  path
                }
              }
              commits(last: 1) {
                nodes {
                  commit {
                    oid
                  }
                }
              }
            }
          }
        }
      `,
      {
        owner: context.repo.owner,
        name: context.repo.repo,
        prNumber: context.issue.number || -1
      }
    );
    if (!prInfo || !prInfo.repository || !prInfo.repository.pullRequest) {
      core.debug('No pull request found');
      return;
    }
    const currentSha =
      prInfo.repository.pullRequest.commits.nodes[0].commit.oid;
    // console.log('Commit from GraphQL:', currentSha);
    const files = prInfo.repository.pullRequest.files.nodes;

    const filesToLint = files.map(f => f.path);
    const checkId = await getOrAddCheck(octokit, context, currentSha, postAs);
    setTimeout(
      async () =>
        await completeCheck(
          checkId,
          octokit,
          context,
          'success',
          filesToLint.join(', ')
        ),
      5000
    );
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
