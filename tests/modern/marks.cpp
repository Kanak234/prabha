#include <iostream.h>
#include <conio.h>

void main()
{
    clrscr();
    char name[20];
    int m1, m2, m3;
    cout << "Enter name: ";
    cin >> name;
    cout << "Enter 3 marks: ";
    cin >> m1 >> m2 >> m3;
    float avg = (m1 + m2 + m3) / 3.0;
    cout << "Student: " << name << endl;
    cout << "Average: " << avg << endl;
    if (avg >= 33)
        cout << "Result: PASS" << endl;
    else
        cout << "Result: FAIL" << endl;
    getch();
}
