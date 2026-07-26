#!/bin/sh
# Periodically commits in-progress subagent work to the feature branch.
# The container is ephemeral, several agents are writing concurrently, and
# uncommitted work is lost if the session is reclaimed. Intentionally silent:
# it must not generate notifications while agents are running.
cd /home/user/tatsucode || exit 1
END=$(( $(date +%s) + 5400 ))
while [ "$(date +%s)" -lt "$END" ]; do
  if [ -n "$(git status --porcelain)" ]; then
    git add -A >/dev/null 2>&1
    git -c user.email=tatsuno0627@gmail.com -c user.name="Claude" \
        commit -q -m "wip: subagent work in progress" >/dev/null 2>&1
    git push origin claude/aaa-fps-threejs-0fdwwc >/dev/null 2>&1
  fi
  sleep 90
done
