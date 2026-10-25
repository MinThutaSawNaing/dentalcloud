import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('.', import.meta.url));
const read = (name: string) => readFileSync(`${directory}/${name}`, 'utf8');

describe('mydentist2 production deployment safeguards', () => {
  it('keeps runtime unprivileged, bounded and inaccessible on public container ports', () => {
    const compose = read('compose.yml');
    expect(compose).toContain('127.0.0.1:${APP_PORT:');
    expect(compose).toContain('read_only: true');
    expect(compose).toContain('user: "101:101"');
    expect(compose).toContain('mem_limit: 64m');
    expect(compose).toContain('pids_limit: 64');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).not.toContain('privileged: true');
  });

  it('uses executable Linux line endings for every shell entrypoint', () => {
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sh'))) {
      const script = read(name);
      expect(script.startsWith('#!/bin/bash\n'), name).toBe(true);
      expect(script, name).not.toContain('\r');
    }
  });

  it('does not serve a clinical application over plaintext before TLS', () => {
    const http = read('site-http.conf');
    expect(http).toContain('/.well-known/acme-challenge/');
    expect(http).toContain('return 503');
    expect(http).not.toContain('proxy_pass');
    expect(read('site-https.conf')).toContain('return 301 https://mydentist2.dentalcloud.asia$request_uri;');
  });

  it('validates SHA and archive bounds before deploying and switching traffic', () => {
    const deploy = read('deploy.sh');
    expect(deploy).toContain('^[a-f0-9]{40}$');
    expect(deploy).toContain('resource.RLIMIT_AS');
    expect(deploy).toContain('signal.alarm(120)');
    expect(deploy).toContain('".." in path.parts');
    expect(deploy).toContain('mode="r|"');
    expect(deploy).not.toContain('getmembers()');
    expect(deploy.indexOf('compose up -d --wait')).toBeLessThan(deploy.indexOf('switched=1'));
    expect(deploy).toContain('/release.txt) == "$sha"');
  });

  it('waits for asynchronous nginx reload while preserving exact TLS release verification and rollback', () => {
    const deploy = read('deploy.sh');
    expect(deploy).toContain('for attempt in {1..15}; do');
    expect(deploy).toContain('(( verified )) ||');
    expect(deploy.indexOf('(( verified )) ||')).toBeLessThan(deploy.indexOf('committed=1'));
    expect(deploy).toContain('cp "$work/previous-upstream.conf" /etc/nginx/snippets/mydentist2-upstream.conf');
  });

  it('pins the base image and restricts SSH to the deploy command', () => {
    expect(read('Dockerfile')).toMatch(/FROM .+@sha256:[a-f0-9]{64}/);
    expect(read('Dockerfile')).toContain('COPY --chmod=644 nginx.conf');
    expect(read('ssh-command.sh')).toContain('SSH_ORIGINAL_COMMAND');
    expect(read('ssh-command.sh')).toContain('^deploy\\ ([a-f0-9]{40})$');
  });
});