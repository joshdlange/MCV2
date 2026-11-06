const numbered = (names: string) => names.split('\n').map((name, i) => ({
  cardNumber: String(i + 1), name, description: null as string | null,
}));

export const vintageChecklists = [
  {
    parent: '1966-marvel-super-heroes-club-art-posters', year: 1966,
    cards: numbered(`Captain America
Dr. Strange
Iron Man
Spiderman
Submariner
The Hulk
The Human-Torch
Thor`),
  },
  {
    parent: '1967-philadelphia-marvel-stickers', year: 1967,
    cards: `The Human Torch|I must get that roof fixed!
The Human Torch|How do you like your hamburgers?
Daredevil|It might have been easier to take the elevator.
Thor|That's right, this big! But it got away!
The Hulk|My father can lick your father!
[Mr. Fantastic & Invisible Girl]|But I thought you took the garbage out!
The Thing|It's Clobberin' Time!
The Thing|No fair using water guns!
The Human Torch|I wish I'd used that suntan lotion!
Iron Man|What if I am a high school drop-out?
Daredevil|Taxi!
Spider-Man|Some web shooter! I can't shut it off!
Thor|You sent for a carpenter?
Submariner|I'm the only wash-and-wear hero in town!
Submariner|Yipe! That water's cold!
The Human Torch|Butter-Fingers!
The Thing|Stop talking! While I'm interrupting.
Daredevil|Now--- Where did I leave my clothes?
Thor|Why, yes, I do set my hair myself!
The Thing|I'm not fat! I'm just short for my width!
Spider-Man|Aren't we a little too old to be playing leapfrog, Herman?
The Hulk|Which hand has the chocolate candy?
Daredevil|Who moved the trapeze?
Dr. Strange|All I get is nag, nag, nag!
The Thing|That dry skin cream is just no good!
Submariner|Who stole my pants?
Daredevil|Darn! Missed the bus again.
Iron Man|Well, there goes my last roll of caps!
Spider-Man|But mother, I'm too old for dancing lessons!
The Hulk|What do you mean you don't have my shoe size?
The Hulk|Who used up the hot water?
The Thing|Clyde! How you've changed!
Iron Man|Ouch!
Dr. Strange|If you can't beat 'em---Call them names!
Captain America|No lady, this isn't your trash can lid!
The Thing|I may not be brave, but I'm handsome!
Iron Man|Let's see now----What's good for rust?
The Hulk|This is the last time I'll babysit!
Spider-Man|I must have made a wrong turn.
Iron Man|My work is so secret, even I don't know what I'm doing!
Thor|Turn that air conditioner off!
Spider-Man|Smile! Later today you won't feel like it.
Spider-Man|May I leave the room?
Iron Man|They just don't make chains the way they used to!
The Hulk|Rah! Rah! Team!
Submariner|Which way is the men's locker room?
The Hulk|The dance is tonight? Why isn't my suit ready?
The Hulk|One, two, Cha, cha, cha!
Spider-Man|Hey lady---you dropped your package!
Captain America|Regular aspirin just isn't strong enough!
[Mr. Fantastic, Invisible Girl, & The Thing]|We're that new singing group---"Him, her and it".
Thor|One more word out of you, Charlie, and you get it!
Captain America|Jaywalker!
Captain America|May I take two giant steps?
The Human Torch|Don't you call me a slob!`.split('\n').map((line, i) => {
      const [name, description] = line.split('|');
      return { cardNumber: String(i + 1), name, description };
    }),
  },
  {
    parent: '1977-marvel-super-heroes', year: 1977,
    cards: numbered(`Absorbing Man
Black Bolt
Captain America
Captain Britain
Daredevil
Doctor Doom
Doctor Octopus
Doctor Strange
Galactus
Ghost Rider
Goliath
Hammerhead
Invisible Girl
Iron Man
Loki
Mephisto
Morbius
Mr. Fantastic
Spider-Man
Tarantula
The Abomination
The Black Panther
The Dread Dormammu
The Green Goblin
The Gremlin
The Grizzly
The Hulk
The Human Top
The Human Torch
The Jackal
The Mighty Thor
The Red Skull
The Rhino
The Silver Surfer
The Sub-Mariner
The Thing
The Vision
The Vulture
The Wasp
Tiger Shark
Character List CL
Game Rules`),
  },
];
