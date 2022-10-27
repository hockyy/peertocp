#include <unistd.h>
#include <iostream>
#include <cstdlib>
#include <random>
#include <chrono>
using namespace std;
using namespace chrono;
mt19937_64 rng(chrono::steady_clock::now().time_since_epoch().count()); //For LL

int main(){
  const int OneSecond = 1e6;
  const int HalfSecond = OneSecond>>1;
  for(int i = 1;i <= 100;i++){
    double sleepDuration = (rng()%OneSecond) + HalfSecond;
    usleep(sleepDuration);
    milliseconds ms = duration_cast< milliseconds >(
        system_clock::now().time_since_epoch()
    );
    cout << ms.count() << endl;
  }
  return 0;
}