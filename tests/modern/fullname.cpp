#include <iostream.h>
#include <stdio.h>
#include <string.h>
#include <conio.h>

void main()
{
    char full[50];
    int far *p = NULL;
    cout << "Enter full name: ";
    gets(full);
    cout << "Hello, " << full << "!" << endl;
    cout << "Length: " << strlen(full) << endl;
    if (p == NULL)
        cout << "p is empty" << endl;
    if (strlen(full) == 0)
        return;
    cout << "Done" << endl;
    getch();
}
