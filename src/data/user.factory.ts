import { uniqueId } from './unique';

export interface UserData {
  name: string;
  email: string;
  password: string;
  title: 'Mr' | 'Mrs';
  birthDate: { day: number; month: number; year: number };
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  country: 'India' | 'United States' | 'Canada' | 'Australia' | 'Israel' | 'New Zealand' | 'Singapore';
  state: string;
  city: string;
  zipcode: string;
  mobileNumber: string;
}

/**
 * Builds a valid shop customer. Every call returns a new, unique e-mail so tests never
 * share accounts on the public demo site. Override only what the test cares about.
 */
export function buildUser(overrides: Partial<UserData> = {}): UserData {
  const id = uniqueId('pw');
  return {
    name: `QA ${id.slice(-6)}`,
    // automationexercise.com requires a syntactically valid address; example.com is reserved (RFC 2606).
    email: `${id.toLowerCase()}@example.com`,
    password: `Pw-${id.slice(-8)}!`,
    title: 'Mrs',
    birthDate: { day: 14, month: 6, year: 1991 },
    firstName: 'Quinn',
    lastName: 'Archer',
    company: 'E2E Labs',
    address1: '221 Test Street',
    address2: 'Suite 4',
    country: 'Canada',
    state: 'Ontario',
    city: 'Toronto',
    zipcode: 'M5V 2T6',
    mobileNumber: '4165550100',
    ...overrides,
  };
}
