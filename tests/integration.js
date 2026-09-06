/* Proves the extension's exact runtime contract without VS Code:
 * fd3 protocol pipe, stdout separation, getch over stdin, scan codes. */
const cp = require('child_process');
const fs = require('fs');

const results = []; let failed = 0;
function ok(name, cond) { results.push((cond?'  ok   ':'  FAIL ')+name); if(!cond) failed++; }

// program: draws, printf's to stdout, getch's twice (char + arrow), reports key codes on screen
fs.writeFileSync('/tmp/it.c', `
#include <graphics.h>
#include <conio.h>
#include <stdio.h>
int main(){
  int gd=DETECT,gm; initgraph(&gd,&gm,"");
  setcolor(YELLOW); circle(100,100,40);
  printf("plain stdout line\\n");
  int a=getch();
  int b=getch();
  int c=(b==0)?getch():-1;
  char buf[64]; sprintf(buf,"keys %d %d %d",a,b,c);
  outtextxy(10,200,buf);
  prabha_flush();
  return a=='K' && b==0 && c==77 ? 0 : 9;
}`);
cp.execSync('gcc -std=c99 -I runtime /tmp/it.c runtime/prabha_core.c -o /tmp/it -lm');

const child = cp.spawn('/tmp/it', [], { stdio: ['pipe','pipe','pipe','pipe'] });
let proto = '', plain = '', inputRequests = 0, frames = 0, sawInit = false, sawEnd = false;

child.stdio[3].on('data', d => {
  proto += d.toString('latin1');
  let nl;
  while ((nl = proto.indexOf('\n')) !== -1) {
    const line = proto.slice(0, nl); proto = proto.slice(nl+1);
    if (!line.startsWith('##PRABHA##')) continue;
    const m = JSON.parse(line.slice(10));
    if (m.t === 'init') sawInit = true;
    if (m.t === 'frame') frames++;
    if (m.t === 'end') sawEnd = true;
    if (m.t === 'input') {
      inputRequests++;
      if (inputRequests === 1) child.stdin.write('K');                 // plain key
      if (inputRequests === 2) child.stdin.write(Buffer.from([0,77])); // RIGHT arrow, 2 bytes = 2 getch
    }
  }
});
child.stdout.on('data', d => plain += d.toString());

child.on('exit', code => {
  ok('program exit 0 (keys decoded right in C)', code === 0);
  ok('init message on fd3', sawInit);
  ok('frames on fd3', frames >= 2);
  ok('end message on close', sawEnd);
  ok('printf stayed on stdout, clean', plain.trim() === 'plain stdout line');
  ok('stdout carried no protocol', !plain.includes('##PRABHA##'));
  ok('getch asked the panel each time', inputRequests >= 2);
  console.log(results.join('\n'));
  console.log(failed ? '\nINTEGRATION FAILED' : '\nINTEGRATION PASSED');
  process.exit(failed ? 1 : 0);
});
setTimeout(() => { console.log('TIMEOUT'); child.kill(); process.exit(1); }, 15000);
