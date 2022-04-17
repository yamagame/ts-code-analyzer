import { propType } from '../index';

export const address = (props: propType) => {
  return `address: ${props.info.address.address1} ${props.info.address.address2}`;
};

export const user = ({ id, info: { address } }: propType) => {
  return `userid ${id} ${address.address1} ${address.address2}`;
};
