#!/usr/bin/env python3
"""Updates the Max box from GitHub: download the latest version, set it up, restart if needed.

Started by max-update.service when Max asks (the control panel's "Update now", "Max, update
yourself", or the nightly automatic update): Max leaves a note in /run/max/update-request.
Runs as root, the way the setup does, and reports progress in /run/max/update.json (the
control panel and the face read it). The full log is in /var/log/max-update.log.

    max-update.py            update now (if there is something new)
    max-update.py version    only write /run/max/version.json (at every start)

It uses the answers from the first setup (/etc/max/box.conf: user, folder, screen), so it never
asks anything. Your .env, Max's memory (data/) and boot-logo.png are untouched: they aren't
part of the code. Local edits to the code are put aside first (git stash), never lost.
If the setup fails, the code goes back to the version that was running.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time

RUN = os.environ.get('MAX_RUN_DIR', '/run/max')
CONF = '/etc/max/box.conf'
LOG = '/var/log/max-update.log'
BRANCH = os.environ.get('MAX_UPDATE_BRANCH', 'main')
# Start-up settings: when the setup changes one of these, the box must restart to apply it.
BOOT_FILES = ['/boot/firmware/config.txt', '/boot/firmware/cmdline.txt']


def conf():
    values = {}
    try:
        with open(CONF) as f:
            for line in f:
                m = re.match(r'^([A-Z_]+)=(.*)$', line.strip())
                if m:
                    values[m.group(1)] = m.group(2).strip('"')
    except OSError:
        pass
    return values


CONF_VALUES = conf()
USER = CONF_VALUES.get('MAX_USER', '')
REPO = CONF_VALUES.get('MAX_REPO', '')


def log(msg):
    line = time.strftime('%Y-%m-%d %H:%M:%S ') + msg
    print(line, flush=True)
    try:
        with open(LOG, 'a') as f:
            f.write(line + '\n')
    except OSError:
        pass


def write_json(name, data):
    os.makedirs(RUN, exist_ok=True)
    path = os.path.join(RUN, name)
    with open(path + '.tmp', 'w') as f:
        json.dump(data, f)
    os.chmod(path + '.tmp', 0o644)
    os.replace(path + '.tmp', path)


def status(state, message, **extra):
    write_json('update.json', {'state': state, 'message': message, 'at': int(time.time() * 1000), **extra})
    log(f'[{state}] {message}')


def git(*args, timeout=180):
    """git in Max's folder, as its owner (git refuses folders owned by someone else)."""
    cmd = ['runuser', '-u', USER, '--', 'git', '-C', REPO, *args] if USER and os.geteuid() == 0 else ['git', '-C', REPO, *args]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f'git {args[0]}: {(r.stderr or r.stdout).strip()[:300]}')
    return r.stdout.strip()


def source_url():
    """Where updates come from: the folder's GitHub address, as https (public repositories need no login)."""
    url = os.environ.get('MAX_UPDATE_URL') or CONF_VALUES.get('MAX_UPDATE_URL') or ''
    if not url:
        try:
            url = git('remote', 'get-url', 'origin')
        except RuntimeError:
            url = ''
    m = re.match(r'^(?:git@github\.com:|ssh://git@github\.com/|https://[^/]*github\.com/)([^/]+/[^/]+?)(?:\.git)?/?$', url)
    return f'https://github.com/{m.group(1)}.git' if m else url


def title(message):
    """A change's readable title: a merged pull request's own title rather than "Merge pull request #n from ..."."""
    lines = [l.strip() for l in message.splitlines() if l.strip()]
    if len(lines) > 1 and lines[0].startswith('Merge pull request #'):
        return lines[1]
    return lines[0] if lines else ''


def write_version():
    try:
        url = source_url()
        m = re.search(r'github\.com/([^/]+/[^/]+?)(?:\.git)?$', url)
        write_json('version.json', {
            'sha': git('rev-parse', 'HEAD'),
            'date': git('log', '-1', '--format=%cI'),
            'subject': title(git('log', '-1', '--format=%B')),
            'repo': m.group(1) if m else '',
            'branch': BRANCH,
        })
    except Exception as e:  # noqa: BLE001
        log(f'Could not read the installed version: {e}')


def fingerprint():
    h = hashlib.sha256()
    for path in BOOT_FILES:
        try:
            with open(path, 'rb') as f:
                h.update(f.read())
        except OSError:
            pass
    return h.hexdigest()


def update():
    try:
        os.remove(os.path.join(RUN, 'update-request'))
    except OSError:
        pass
    if not USER or not REPO or not os.path.isdir(REPO):
        status('failed', 'Updates need the setup to have been run once by hand (sudo ./scripts/pi/setup.sh).')
        return 1
    url = source_url()
    status('checking', 'Checking for a new version')
    try:
        git('fetch', '--quiet', url, BRANCH)
        new = git('rev-parse', 'FETCH_HEAD')
        old = git('rev-parse', 'HEAD')
    except Exception as e:  # noqa: BLE001
        status('failed', f'Could not reach GitHub ({e}). Check the internet connection.')
        return 1
    if new == old:
        status('uptodate', 'Max is already up to date.')
        write_version()
        return 0
    count = git('rev-list', '--count', f'{old}..{new}')
    status('updating', f'Installing the new version ({count} change{"" if count == "1" else "s"}). Max restarts on his own; this takes 5 to 15 minutes.',
           old=old, new=new)
    if git('status', '--porcelain', '--untracked-files=no'):
        git('stash', 'push', '--quiet', '-m', f'Local changes put aside by the update on {time.strftime("%Y-%m-%d %H:%M")}')
        log('Local changes to the code were put aside (see: git stash list)')
    git('checkout', '--quiet', '-B', BRANCH, new)
    before = fingerprint()
    env = {**os.environ, 'MAX_USER': USER, 'MAX_UNATTENDED': '1'}
    with open(LOG, 'a') as out:
        r = subprocess.run(['bash', os.path.join(REPO, 'scripts/pi/setup.sh')], cwd=REPO, env=env,
                           stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, timeout=3600)
    if r.returncode != 0:
        git('checkout', '--quiet', '-B', BRANCH, old)
        write_version()
        status('failed', 'The update did not finish, so Max stays on the version he had. Details: /var/log/max-update.log',
               old=old, new=new)
        return 1
    write_version()
    if fingerprint() != before:
        status('rebooting', 'Updated. Restarting the box to apply a start-up setting.', old=old, new=new)
        time.sleep(5)
        subprocess.run(['systemctl', 'reboot'])
        return 0
    status('done', 'Updated to the latest version.', old=old, new=new)
    return 0


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'version':
        write_version()
        sys.exit(0)
    try:
        sys.exit(update())
    except Exception as e:  # noqa: BLE001
        status('failed', f'The update stopped unexpectedly: {e}')
        sys.exit(1)
