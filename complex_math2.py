import math
import scipy.constants as const

#print(const.h) #print Planck's constant
#print(const.c) #print speed of light

#define variables for find_time_and_velocity
planeLength = 0.0
beamDistance = 20.0
timeSilent = 0.0
timeRight = 0.0

planeVelocity = 0.0

parenthesis1 = 0.0
parenthesis2 = 0.0



def find_length(timeSilent, timeRight):
    parenthesis1 = timeSilent/timeRight
    parenthesis2 = parenthesis1 + 1
    planeLength = parenthesis2 * beamDistance
    
    print(f"The length of the plane is: {planeLength} meters")

    return planeLength

def find_velocity(timeRight):
    planeVelocity = beamDistance / timeRight

    print(f"The velocity of the plane is: {planeVelocity} m/s")
    print(f"----------------------------------")
    print(f" ")

    return planeVelocity

# this is the main code that validates the input and calls the find plane function
# do any output processing here and other global error handling
try:

    #inputs for find_length_and_velocity
    timeSilent = float(input("Enter the TimeSilent: "))
    timeRight = float(input("Enter the Time Right: "))
    #NumberPhotonsDetected2 = float(input("Enter the NumberPhotonsDetected: "))
    print(f"-")
    
    
    # Calculate the function
    length = find_length(timeSilent, timeRight)
    planeVelocity = find_velocity(timeRight)
    #NumberPhotonsDetected1 = find_time_and_detectedPhotons(InputtedPlaneLength, InputtedPlaneSpeed)

    
    # Display the result
   # print(f"The result of the complex equation is: {length}")
    
except ValueError:
    print("Please enter valid numbers for x, y, and z.")