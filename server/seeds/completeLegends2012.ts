import { db } from '../db';
import { completeLegendsYearTx } from './completeLegends2010';

export const legends2012Lists = [
  { name: 'Hulk', key: 'hulk', credits: [
    ['Jim Cheung', 'Jim Cheung'],
    ["Gabriele Dell'Otto", "Gabriele Dell'Otto"],
    ['Ed McGuinness', 'Ed McGuinness'],
    ['Greg Horn', 'Carlo Pagulayan'],
    ['John Barber', 'Mario Gully'],
    ['Mike Deodato Jr.', 'Mike Deodato Jr.'],
    ['David Finch', 'Greg Land'],
    ['Ed McGuinness', 'Marko Djurdjevic'],
    ['Francesco Mattina', "Gabriele Dell'Otto"],
  ] },
  { name: 'Moon Knight', key: 'moon-knight', credits: [
    ['Dave Wilkins', "Gabriele Dell'Otto"],
    ['Frank G. Darmata, David Finch', 'Mark Texeira'],
    ['Frank G. Darmata, David Finch', 'Mico Suayan'],
    ['Arthur Suydam', 'Arthur Suydam'],
    ['Leinil Francis Yu', 'Mico Suayan'],
    ['Leinil Francis Yu', "Gabriele Dell'Otto"],
    ['David Finch', 'Bong Dazo'],
    ['Joshua Medors', 'Bong Dazo'],
    ['Francesco Mattina', "Gabriele Dell'Otto"],
  ] },
  { name: 'Storm', key: 'storm', credits: [
    ['Mike Deodato Jr.', 'Diogenes Nevron'],
    ['Tom Grummett', 'Tom Grummett'],
    ['Diogenes Nevron', 'Stephane Piru'],
    ['Salvador Larroca', 'Simone Bianchi'],
    ['Greg Land', 'Marcus To'],
    ['Salvador Larroca', 'Allen Davis'],
    ['Michael Turner', 'Mike Mayhew'],
    ['Daniel Yardin', 'Greg Land'],
    ['Simone Bianchi', 'Phil Jimenez'],
  ] },
  { name: 'Thing', key: 'thing', credits: [
    ['Andrea Di Vito', 'Andrea Di Vito'],
    ['Carlo Pagulayan', 'Andrea Di Vito'],
    ['Steve McNiven', 'Clayton Henry'],
    ['Leonard Kirk', 'Bryan Hitch'],
    ['Karl Kesel, Mike Wieringo', 'Alan Davis'],
    ['Arthur Adams', 'Rafa Sandoval'],
    ['Mike Wieringo', 'Paul Pelletier'],
    ['Kau Amac;etp', "Gabriele Dell'Otto"],
    ['Steve McNiven', 'Marko Djurdjevic'],
  ] },
  { name: 'Ms. Marvel', key: 'ms-marvel', credits: [
    ['Greg Horn', 'Greg Horn'],
    ['Frank Cho', 'Iban Coello'],
    ['Greg Horn', 'Greg Horn'],
    ['Sana Takeda', 'Sana Takeda'],
    ['Greg Horn', 'Phil Jimenez'],
    ['Michael Turner', 'Roberto De La Torre'],
    ['Greg Horn', 'Greg Horn'],
    ['Frank Martin', 'Roberto De La Torre'],
    ['Sana Takeda', 'Sana Takeda'],
  ] },
  { name: 'Ghost Rider', key: 'ghost-rider', credits: [
    ['Marko Djurdjevic', 'Marko Djurdjevic'],
    ['Marko Djurdjevic', 'Clayton Crain'],
    ['Clayton Crain', 'Clayton Crain'],
    ['Clayton Crain', 'Arthur Suydam'],
    ['Clayton Crain', 'Clayton Crain'],
    ['Clayton Crain', 'Clayton Crain'],
    ['Clint Langley', 'Clint Langley'],
    ['Marko Djurdjevic', 'Marko Djurdjevic'],
    ['Mark Texeira', 'Clayton Crain'],
  ] },
].map(list => ({
  ...list, cards: list.credits.map(([front, back], i) => ({
    cardNumber: `L${i+1}`, name: list.name, description: `Artists — Front: ${front}; Back: ${back}`,
  })),
}));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const completeLegends2012Tx = (tx: Tx) => completeLegendsYearTx(tx, 2012, legends2012Lists);
export const completeLegends2012 = () => db.transaction(completeLegends2012Tx);
