#include <stdio.h>
#include <conio.h>

void main()
{
    char city[30];
    int age;
    clrscr();
    printf("Enter city: ");
    gets(city);
    printf("Enter age: ");
    scanf("%d", &age);
    printf("%s, age %d\n", city, age);
    if (age < 0)
        return;
    printf("Next year: %d\n", age + 1);
    getch();
}
