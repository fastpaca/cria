/** Minimal optional JSX example using the Cria JSX runtime. */
import { Region, render } from "@fastpaca/cria/jsx";

const prompt = (
  <Region priority={0}>
    <Region priority={0}>You are a friendly assistant.</Region>
    <Region priority={1}>Say hello to the user.</Region>
  </Region>
);

const tokenizer = (text: string): number => Math.ceil(text.length / 4);

async function main(): Promise<void> {
  const output = await render(prompt, { tokenizer, budget: 100 });
  console.log(output);
}

main().catch(console.error);
