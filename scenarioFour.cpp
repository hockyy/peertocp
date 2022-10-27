#include <chrono>
#include <iostream>
// ...

using namespace std;
using namespace chrono;
int main(){
milliseconds ms = duration_cast< milliseconds >(
    system_clock::now().time_since_epoch()
);
cout << ms.count() << endl;
}