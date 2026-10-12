#include <iostream.h>
#include <conio.h>

void main()
{
    int ch;
    do {
        cout << "1. Hello  2. Exit : ";
        cin >> ch;
        if (ch == 1) cout << "Hello!" << endl;
    } while (ch != 2);
    getch();
}
