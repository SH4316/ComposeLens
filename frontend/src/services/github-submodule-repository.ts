const OWNER = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+$/;

function invalidSubmodule(): never {
  throw new Error('공개 GitHub submodule 저장소 URL을 확인해주세요. github.com의 owner/repository 형식만 지원합니다.');
}

function repositoryPath(path: string, stripGitSuffix: boolean): string {
  const [owner, rawName, ...remaining] = path.split('/');
  const name = stripGitSuffix ? rawName?.replace(/\.git$/, '') : rawName;
  if (!owner || !name || remaining.length || owner.length > 39 || name.length > 100
    || !OWNER.test(owner) || !REPOSITORY.test(name) || name === '.' || name === '..') {
    invalidSubmodule();
  }
  return `${owner}/${name}`;
}

/** Identify a GitHub submodule remote without credentials or network access. */
export function submoduleRepository(parentRepository: string, gitUrl: unknown): string {
  const parent = repositoryPath(parentRepository, false);
  // Inspect the original value before any URL parser can normalize traversal or credentials.
  if (typeof gitUrl !== 'string' || !gitUrl || /[\s\\%?#\u0000-\u001f\u007f-\u009f]/.test(gitUrl)) {
    invalidSubmodule();
  }

  if (gitUrl.startsWith('../')) {
    // Git treats the complete parent remote as a directory: ../child.git is a sibling.
    // https://git-scm.com/docs/git-submodule#Documentation/git-submodule.txt-add
    const parts = parent.split('/');
    let relative = gitUrl;
    while (relative.startsWith('../')) {
      if (!parts.length) invalidSubmodule();
      parts.pop();
      relative = relative.slice(3);
    }
    const child = relative.split('/');
    if (child.some((part) => !part || part === '.' || part === '..')) invalidSubmodule();
    return repositoryPath([...parts, ...child].join('/'), true);
  }

  const absolute = gitUrl.match(/^([A-Za-z]+):\/\/([^/]+)\/(.+)$/);
  if (absolute) {
    const [, rawProtocol, authority, path] = absolute;
    const protocol = rawProtocol.toLowerCase();
    const isGithub = authority.toLowerCase() === 'github.com';
    const isGithubSsh = authority.startsWith('git@') && authority.slice(4).toLowerCase() === 'github.com';
    if (((protocol === 'https' || protocol === 'git') && isGithub) || (protocol === 'ssh' && isGithubSsh)) {
      return repositoryPath(path, true);
    }
    invalidSubmodule();
  }

  const scp = gitUrl.match(/^git@([^:]+):(.+)$/);
  if (scp && scp[1].toLowerCase() === 'github.com') return repositoryPath(scp[2], true);
  return invalidSubmodule();
}
