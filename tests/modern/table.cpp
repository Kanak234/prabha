#include <iostream.h>
#include <iomanip.h>
#include <conio.h>

main()
{
    int n;
    cout << "Table of: ";
    cin >> n;
    for (int i = 1; i <= 10; i++)
        cout << setw(3) << n << " x " << setw(2) << i << " = " << setw(4) << n * i << endl;
    // getch(); <- comment ke andar, badalna nahi
    cout << "cout << \"void main()\" string mein hai" << endl;
    getch();
    return 0;
}
