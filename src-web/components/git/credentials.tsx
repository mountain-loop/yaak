import { showPromptForm } from '../../lib/prompt-form';
import { Banner } from '../core/Banner';
import { InlineCode } from '../core/InlineCode';

export interface GitCredentials {
  username: string;
  password: string;
}

export async function promptCredentials({
  url: remoteUrl,
  error,
}: {
  url: string;
  error: string | null;
}): Promise<GitCredentials | null> {
  const isGitHub = /github\.com/i.test(remoteUrl);
  const userLabel = isGitHub ? 'GitHub Username' : 'Username';
  const passLabel = isGitHub ? 'GitHub Personal Access Token' : 'Password / Token';
  const userDescription = isGitHub ? 'Use your GitHub username (not your email).' : undefined;
  const passDescription = isGitHub
    ? 'GitHub requires a Personal Access Token (PAT) for write operations over HTTPS. Passwords are not supported.'
    : 'Enter your password or access token for this Git server.';
  const r = await showPromptForm({
    id: 'git-credentials',
    title: 'Credentials Required',
    description: error ? (
      <Banner color="danger">{error}</Banner>
    ) : (
      <>
        Enter credentials for <InlineCode>{remoteUrl}</InlineCode>
      </>
    ),
    inputs: [
      { type: 'text', name: 'username', label: userLabel, description: userDescription },
      {
        type: 'text',
        name: 'password',
        label: passLabel,
        description: passDescription,
        password: true,
      },
    ],
  });
  if (r == null) return null;

  const username = String(r.username || '');
  const password = String(r.password || '');
  return { username, password };
}
