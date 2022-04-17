import { address } from './libs/hello1';
import { hello as hello2 } from 'libs/hello2';

export interface propType {
  id: string;
  info: {
    name: string;
    address: {
      postalCode: string;
      address1: string;
      address2: string;
    };
  };
}

const props = {
  id: '1000',
  info: {
    name: 'user-name',
    address: {
      postalCode: '100-1000',
      address1: 'address1',
      address2: 'address2',
    },
  },
};

async function main(argv: string[]) {
  console.log(argv[0]);
  console.log(address(props));
  console.log(hello2);
}

if (require.main === module) {
  main(process.argv);
}
