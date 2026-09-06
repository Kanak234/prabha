#!/usr/bin/env bash
# PRABHA test suite: compile everything, run the protocol tests, render frames.
set -e
cd "$(dirname "$0")/.."
echo "== compiling runtime =="
gcc -Wall -Wextra -std=c99 -I runtime -c runtime/prabha_core.c -o /tmp/pr_core.o
echo "== compiling every example =="
for f in examples/*.c; do
  gcc -Wall -std=c99 -I runtime "$f" runtime/prabha_core.c -o "/tmp/pr_$(basename "$f" .c)" -lm
  echo "  ok  $f"
done
echo "== API coverage program =="
gcc -Wall -std=c99 -I runtime tests/all_graphics.c runtime/prabha_core.c -o /tmp/pr_all -lm
/tmp/pr_all > /tmp/pr_all.out
python3 tests/decode.py /tmp/pr_all.out /tmp/pr_all_frame
echo "== conio program =="
gcc -Wall -std=c99 -I runtime tests/conio_test.c runtime/prabha_core.c -o /tmp/pr_conio -lm
printf 'K' | /tmp/pr_conio > /tmp/pr_conio.out
python3 tests/decode.py /tmp/pr_conio.out /tmp/pr_conio_frame
echo "== extension contract (fd3, stdin keys, stdout split) =="
node tests/integration.js
echo "ALL PRABHA TESTS PASSED"
