/*
 * A classic Turbo C++ program — exactly the style taught in college labs.
 *
 * Notice: <iostream.h> (not <iostream>), unqualified cout/cin, void main(),
 * clrscr() and getch(). None of this compiles on a modern g++ by itself.
 * PRABHA's Turbo C++ compatibility (on by default) runs it unchanged.
 *
 * Run it:  Ctrl+Alt+G
 */
#include <iostream.h>
#include <conio.h>
#include <iomanip.h>

void main()
{
    clrscr();

    int marks[5];
    int total = 0;

    cout << "=== Student Marks ===" << endl;
    for (int i = 0; i < 5; i++)
    {
        cout << "Enter marks for subject " << (i + 1) << ": ";
        cin >> marks[i];
        total += marks[i];
    }

    float average = total / 5.0;

    cout << endl << "----------------------" << endl;
    cout << "Total   : " << setw(4) << total << endl;
    cout << "Average : " << setw(6) << setprecision(2) << average << endl;

    if (average >= 60)
        cout << "Result  : PASS with First Division" << endl;
    else if (average >= 40)
        cout << "Result  : PASS" << endl;
    else
        cout << "Result  : FAIL" << endl;

    cout << endl << "Press any key to exit...";
    getch();
}
