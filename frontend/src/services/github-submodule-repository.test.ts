import { describe, expect, it } from 'vitest';
import { submoduleRepository } from './github-submodule-repository';

describe('submoduleRepository', () => {
  it.each([
    'https://github.com/team/child.git',
    'git://github.com/team/child.git',
    'git@github.com:team/child.git',
    'ssh://git@github.com/team/child.git',
    'https://github.com/team/child',
  ])('identifies a GitHub repository from %s', (url) => {
    expect(submoduleRepository('owner/parent', url)).toBe('team/child');
  });

  it('preserves owner and repository spelling while accepting host case differences', () => {
    expect(submoduleRepository('owner/parent', 'https://GITHUB.COM/Team-1/Child_repo.v2.git')).toBe('Team-1/Child_repo.v2');
    expect(submoduleRepository('owner/parent', 'git@GITHUB.COM:Team-1/Child_repo.v2.git')).toBe('Team-1/Child_repo.v2');
  });

  it('resolves sibling repositories using Git directory-relative URL rules', () => {
    expect(submoduleRepository('owner/parent', '../child.git')).toBe('owner/child');
    expect(submoduleRepository('owner/parent', '../child')).toBe('owner/child');
    expect(submoduleRepository('owner/parent', '../../other/child.git')).toBe('other/child');
    expect(submoduleRepository('Team-1/Parent', '../Child_repo.v2.git')).toBe('Team-1/Child_repo.v2');
  });

  it.each([
    undefined, null, 42, {}, [], '',
    'http://github.com/team/child.git',
    'https://gitlab.com/team/child.git',
    'git@other.example:team/child.git',
    'ssh://git@other.example/team/child.git',
    'https://github.com.evil.example/team/child.git',
    'https://github.com./team/child.git',
    'https://git@github.com/team/child.git',
    'https://token:password@github.com/team/child.git',
    'git://git@github.com/team/child.git',
    'ssh://user@github.com/team/child.git',
    'ssh://GIT@github.com/team/child.git',
    'ssh://git:password@github.com/team/child.git',
    'ssh://github.com/team/child.git',
    'user@github.com:team/child.git',
    'GIT@github.com:team/child.git',
    'https://github.com:443/team/child.git',
    'git://github.com:9418/team/child.git',
    'ssh://git@github.com:22/team/child.git',
    'git@github.com:22/team/child.git',
    'https://github.com/team/child.git?ref=main',
    'https://github.com/team/child.git#main',
    'git@github.com:team/child.git?ref=main',
    '../child.git#main',
    'https://github.com/team/%2e%2e/child.git',
    'https://github.com/team%2fother/child.git',
    'https://github.com/team/child%2Fother.git',
    'https://github.com/team/%252e%252e.git',
    '../%2e%2e/child.git',
    'https://github.com/team/../child.git',
    'https://github.com/./child.git',
    'https://github.com/team/..',
    'https://github.com/team/child.git/extra',
    'https://github.com/team/child.git/',
    'https://github.com//team/child.git',
    'https://github.com/team//child.git',
    'https://github.com/team/child.git\\extra',
    'https://github.com/team/child.git\n',
    'https://github.com/te\tam/child.git',
    'https://github.com/team/child\u0000.git',
    ' https://github.com/team/child.git',
    'https://github.com/team/child name.git',
    'https://github.com/-team/child.git',
    'https://github.com/team-/child.git',
    'https://github.com/team--other/child.git',
    'https://github.com/team_name/child.git',
    'https://github.com/team.name/child.git',
    'https://github.com/team/child!.git',
    'https://github.com/team/.git',
    'https://github.com/team/..git',
    'https://github.com/team/한글.git',
    'github.com/team/child.git',
    '/team/child.git',
    './child.git',
    '../', '../..', '.././child.git', '../nested/../child.git', '../child.git/extra',
    '../../other/../child.git', '../../../other/child.git',
  ])('rejects an unsupported or ambiguous submodule remote: %s', (url) => {
    expect(() => submoduleRepository('owner/parent', url)).toThrow('공개 GitHub submodule');
  });

  it('enforces GitHub owner and repository length limits', () => {
    expect(submoduleRepository('owner/parent', `https://github.com/${'a'.repeat(39)}/${'b'.repeat(100)}.git`)).toBe(`${'a'.repeat(39)}/${'b'.repeat(100)}`);
    expect(() => submoduleRepository('owner/parent', `https://github.com/${'a'.repeat(40)}/child.git`)).toThrow('공개 GitHub submodule');
    expect(() => submoduleRepository('owner/parent', `https://github.com/team/${'b'.repeat(101)}.git`)).toThrow('공개 GitHub submodule');
  });

  it.each(['owner', 'owner/parent/extra', '../parent', 'owner/..', 'owner\\parent', 'owner/parent\n'])(
    'rejects an invalid parent repository: %s',
    (parent) => {
      expect(() => submoduleRepository(parent, '../child.git')).toThrow('공개 GitHub submodule');
    },
  );
});
