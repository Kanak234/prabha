#include <iostream.h>
#include <stdlib.h>
#include <dos.h>

void main()
{
    randomize();
    int r = random(1);
    cout << "random(1) is always " << r << endl;
    cout << "waiting..." << endl;
    delay(50);
    cout << "done" << endl;
}
