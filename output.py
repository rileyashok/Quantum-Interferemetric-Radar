#SPI-R Output

import turtle
import math

# Initialize the turtle screen
screen = turtle.Screen()
screen.setup(width=800, height=800)
screen.title("Quantum Radar Output")

# Create a turtle object
radar = turtle.Turtle()
radar.speed(0)
radar.hideturtle()

# Function to draw a line at a specific angle
def draw_line(length, angle):
    radar.penup()
    radar.goto(0, 0)
    radar.setheading(angle)
    radar.forward(length / 2)
    radar.pendown()
    radar.backward(length)
    radar.penup()
    radar.goto(0, 0)

# Number of systems
num_systems = 64

# Lengths for each system (example values, replace with actual lengths)
lengths = [100, 120, 140, 160, 180, 200, 220, 250, 160, 180, 100, 120, 240, 360, 380, 300,
           60, 90, 160, 180, 200, 220, 240, 260, 280, 200, 120, 140, 160, 180, 200, 220, 
           100, 120, 140, 160, 180, 200, 220, 250, 160, 180, 100, 120, 240, 360, 380, 300,
           60, 90, 160, 180, 200, 220, 240, 260, 280, 200, 120, 140, 160, 180, 200, 220,]

# Draw lines for each system
for i in range(num_systems):
    angle = i * (180 / num_systems)
    draw_line(lengths[i], angle)

# Keep the window open until clicked
screen.mainloop()