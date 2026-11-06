import secretWars1984 from './secret-wars-stickers-1984.json';
import universe1987 from './marvel-universe-i-1987.json';

const numbered = (names: string) => names.split('\n').map((name, i) => ({
  cardNumber: String(i + 1), name, description: null as string | null,
}));

export const vintageChecklists = [
  // Keep prior review-list order stable when appending owner checklists.
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
  {
    parent: '1978-milton-bradley-marvel-comics-super-heroes-card-game', year: 1978,
    cards: [
      ...`The Amazing Spider-Man
The Incredible Hulk
Mister Fantastic
The Thing
The Human Torch
Sue Richards (Invisible Girl)
Captain America
The Invincible Iron Man
The Mighty Thor
Captain Marvel
Doctor Strange (Master of the Mystic Arts)
Daredevil (The Man Without Fear)
The Black Panther
The Falcon
The Silver Surfer
Ghost Rider
Hawkeye
The Vision
Scarlet Witch`.split('\n').flatMap((name, i) => ['A', 'B'].map((letter, j) => ({
        cardNumber: String(i * 2 + j + 1).padStart(2, '0'),
        name,
        description: `Card ${letter}`,
      }))),
      { cardNumber: '39', name: 'Doctor Doom', description: 'Single card / The "Old Maid" equivalent' },
      { cardNumber: '40', name: 'Two-Sided Instruction / Directions Card', description: null },
    ],
  },
  {
    parent: '1984-leaf-marvel-super-heroes-secret-wars-stickers', year: 1984,
    cards: secretWars1984,
  },
  {
    parent: '1986-comic-images-official-marvel-universe-stickers', year: 1986,
    cards: numbered(`Nightcrawler
Colossus
Wolverine
Storm
Phoenix
Rogue
Lockheed
Wolverine
Havok
Wolverine
Shadowcat
Longshot
The Punisher
Daredevil
Silver Surfer
Galactus
Moon Knight
Cloak and Dagger
Elektra
Punisher
Magneto
Wolfsbane
Sunspot
Magma
Warlock
Cannonball
Magik
Spider-Man
Spider-Man
Spider-Man
Spider-Man
Spider-Man
(Spider-Man, black costume)
(Spider symbol)
Iron Man
Hawkeye
Mockingbird
Tigra
Wonder Man
The West Coast Avengers
The West Coast Avengers
Mr. Fantastic
Human Torch
Invisible Woman
Thing
She-Hulk
Fantastic Four
The Mighty Thor
Hulk
Black Panther
Vision
Captain America
Scarlet Witch
Hercules - Prince of Power
The Astonishing Ant-Man
Wasp
Shaman
Vindicator
Talisman
Northstar
Snowbird
Aurora
Box
Dr. Doom
Doctor Octupus
Mephisto
Hobgoblin
Annihilus
Kingpin
Loki
Marvel Girl
Cyclops
Angel
Beast
Iceman
X-Factor
X-Factor`),
  },
  {
    parent: '1987-comic-images-marvel-universe-i', year: 1987,
    cards: universe1987,
  },
  {
    parent: '1987-comic-images-marvel-universe-ii-colossal-conflicts', year: 1987,
    cards: numbered(`Abomination
Absorbing Man
Annihilus
Arcade
Attuma
Baron Blood
Baron Zemo
Beyonder
Blob
Brotherhood of Evil Mutants
Bullseye
Cobra
Collector
Constrictor
Deathlok
Death-Stalker
Destroyer
Doc Samson
Doctor Doom
Doctor Octopus
Dormammu
Dragon Man
Electro
Freedom Force
Green Goblin
Grey Gargoyle
Grim Reaper
Hela
Hellfire Club
Hellions
Hitler
Hobgoblin
Hydra
Juggernaut
Kang
Kingpin
Klaw
Kraven the Hunter
Kurse
Leader
Lizard
Loki
Magneto
Magus
Man-Ape
Mandarin
Mandrill
Marauders
Maximus
Mephisto
Modok
Mojo
Mole Man
Monolith
Morgan Le Fey
Mr. Hyde
Mysterio
Nightmare
Nitro
Owl
Paladin
Phoenix
Pluto
Puppet Master
Red Skull
Rhino
Ringmaster
Sandman
Scarecrow
Scorpion
Sentinels
Serpent
Shuma-Gorath
Silver Samurai
Stilt-Man
Stranger
Surtur
Taskmaster
Thanos
Titanic Three
Ultron
Umar
Unicorn
Viper
Vulture
Wolverine
Wrecking Crew
Yellow Claw
Zzzax
Checklist`),
  },
  {
    parent: '1987-comic-images-marvel-s-magic-moments-stickers', year: 1987,
    cards: numbered(`The Watcher
Galactus
Skrull
Inhumans
Hercules
Gods
Original Black Knight
Black Knight
Kid Colt / Rawhide Kid / Night Rider / Two-Gun Kid
Union Jack
Howling Commandos
Captain America
The Invaders
Captain America
Bucky
Captain America
The Falcon
Bruce Banner
Wolverine
Hulk
Hulk
Wasp / Ant-Man
Janet Van Dyne
Ant-Man
Mjolnir
Beta Ray Bill
Odin & Surtur
Thor & Hela
Iron Man
Tony Stark
Obadiah Stane
Iron Man
Sub-Mariner
Sub-Mariner / Marrina
Silver Surfer / Nova
Dr. Strange
Dr. Strange vs. Dread Dormammu
Dread Dormammu
Peter Parker
Spider-Man / Gwen Stacy / Green Goblin
Spider-Man
Hobgoblin
Spider-Man / Daredevil
Elektra
Bullseye / Elektra
Kingpin
Moon Knight
Moon Knight
Cloak and Dagger
Sub-Mariner / Iron Man
Avengers
She-Hulk
Avengers
Scarlet Witch & Vision
Hawkeye
Wonder Man
Fantastic Four
Doctor Doom
She-Hulk / Mr. Fantastic / Human Torch
Thing
Brotherhood of Evil Mutants
Original X-Men
Marvel Girl
Wolverine
Peter Rasputin
Storm
Rogue / Dazzler / Longshot / Psylocke
James Hudson
Marrina
Alpha Flight
Warlock
New Mutants
Magneto
Original X-Men
Beast
Angel
Captain Mar-Vell
Jean Grey / Phoenix
Guardian
Beyonder`),
  },
];
