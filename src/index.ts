import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

function main(argv: string[]) {
  const arg = yargs(hideBin(argv))
    .command('hello', 'say hello')
    .command('bye', 'say bye')
    .demandCommand(1)
    .help()
    .parseSync();

  switch (arg._[0]) {
    case 'hello':
      console.log('hello');
      break;
    case 'bye':
      console.log('bye');
      break;
  }
}

if (require.main === module) {
  main(process.argv);
}
