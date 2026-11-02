// Workout list for the timer: short names, split into Gym and Home. The saved session's
// `activity_type` is exactly this name. Add or remove names freely; they are just strings.
export const WORKOUT_GROUPS = [
  { id: 'gym', label: 'Gym' },
  { id: 'home', label: 'Home' },
];

const names = (group, list) => list.map((name) => ({ name, group }));

export const WORKOUTS = [
  ...names('gym', [
    'Bench Press', 'Incline Press', 'Chest Fly', 'Back Squat', 'Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raises',
    'Deadlift', 'Romanian Deadlift', 'Hip Thrust', 'Lat Pulldown', 'Seated Row', 'Pull-Ups', 'Shoulder Press',
    'Lateral Raises', 'Face Pulls', 'Bicep Curls', 'Tricep Pushdown', 'Cable Crunch',
    'Treadmill Run', 'Rowing Machine', 'Stationary Bike', 'Stair Climber', 'Elliptical',
  ]),
  ...names('home', [
    'Push-Ups', 'Pike Push-Ups', 'Tricep Dips', 'Squats', 'Lunges', 'Wall Sit', 'Glute Bridge', 'Superman',
    'Plank', 'Side Plank', 'Crunches', 'Leg Raises', 'Mountain Climbers',
    'Burpees', 'Jumping Jacks', 'High Knees', 'Jump Rope', 'Jog', 'Brisk Walk', 'Shadow Boxing', 'Dance Cardio',
    'Yoga Flow', 'Stretching',
  ]),
];

export const workoutByName = (name) => WORKOUTS.find((w) => w.name === name) || null;
