import { db } from '../db';
import { completeLegendsYearTx } from './completeLegends2010';

export const legends2011Lists = [
  { name: 'Thor', key: 'thor', credits: [
    ['Marko Djurdjevic', 'Esad Ribic'],
    ['Olivier Coipel', 'Olivier Coipel'],
    ['Olivier Coipel', 'Olivier Coipel'],
    ['Marko Djurdjevic', 'Billy Tan'],
    ['Marko Djurdjevic', 'Lee Bermejo'],
    ['Mico Suayan', 'Billy Tan'],
    ['Rodney Buchemi', "Gabriele Dell'Otto"],
    ['Billy Tan', 'Olivier Coipel'],
    ['Steve Epting', 'Doug Braithwaite'],
  ] },
  { name: 'Elektra', key: 'elektra', credits: [
    ['Lee Bermejo', 'Rodolfo Migliari'],
    ['Tom Fleming', 'Ian Churchill'],
    ['Lee Bermejo', 'Bill Sienkiewicz'],
    ['Lee Bermejo', 'Lee Bermejo'],
    ['Greg Horn', 'Greg Horn'],
    ['Tom Fleming', 'Renato Arlem'],
    ['Tom Fleming', 'John Romita Jr.'],
    ['Tom Fleming', 'Roberto De La Torre'],
    ['Mike Mayhew', 'Bill Sienkiewicz'],
  ] },
  { name: 'Wolverine', key: 'wolverine', credits: [
    ['Doug Braithwaite', 'Simone Bianchi'],
    ['Mark Texeira', 'Greg Horn'],
    ['Leandro Fernandez', 'Darick Robertson'],
    ['J. Scott Campbell', 'Mike Deodato Jr'],
    ['Doug Braithwaite', 'David Finch'],
    ['Doug Braithwaite', 'David Finch'],
    ['Dave Wilkins', 'Stephen Segovia'],
    ['John Cassaday', 'Eric Nguyen'],
    ["Gabriele Dell'Otto", 'Lou Kang'],
  ] },
].map(list => ({
  ...list, cards: list.credits.map(([front, back], i) => ({
    cardNumber: `L${i+1}`, name: list.name, description: `Artists — Front: ${front}; Back: ${back}`,
  })),
}));

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const completeLegends2011Tx = (tx: Tx) => completeLegendsYearTx(tx, 2011, legends2011Lists);
export const completeLegends2011 = () => db.transaction(completeLegends2011Tx);
