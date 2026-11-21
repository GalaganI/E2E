import type { APIRequestContext } from '@playwright/test';
import { parseBody } from './api-response';
import { requestResilient } from '@/utils/transient';
import {
  BrandsResponseSchema,
  MessageResponseSchema,
  ProductsResponseSchema,
  UserDetailResponseSchema,
  type MessageResponse,
  type Product,
  type UserDetail,
} from './schemas/automation-exercise.schemas';
import type { UserData } from '@/data/user.factory';

/**
 * Typed client for the documented Automation Exercise endpoints only.
 * Form-encoded bodies match the API documentation; the API ignores JSON bodies.
 */
export class AutomationExerciseApi {
  constructor(private readonly request: APIRequestContext) {}

  async getProducts(): Promise<Product[]> {
    const response = await requestResilient(() => this.request.get('/api/productsList'));
    return (await parseBody(response, ProductsResponseSchema)).products;
  }

  async getBrands(): Promise<{ id: number; brand: string }[]> {
    const response = await requestResilient(() => this.request.get('/api/brandsList'));
    return (await parseBody(response, BrandsResponseSchema)).brands;
  }

  async searchProducts(term: string): Promise<Product[]> {
    const response = await requestResilient(() =>
      this.request.post('/api/searchProduct', { form: { search_product: term } }),
    );
    return (await parseBody(response, ProductsResponseSchema)).products;
  }

  async verifyLogin(email: string, password: string): Promise<MessageResponse> {
    const response = await requestResilient(() =>
      this.request.post('/api/verifyLogin', { form: { email, password } }),
    );
    return parseBody(response, MessageResponseSchema);
  }

  async createAccount(user: UserData): Promise<MessageResponse> {
    const response = await requestResilient(() =>
      this.request.post('/api/createAccount', { form: toAccountForm(user) }),
    );
    return parseBody(response, MessageResponseSchema);
  }

  async updateAccount(user: UserData): Promise<MessageResponse> {
    const response = await requestResilient(() =>
      this.request.put('/api/updateAccount', { form: toAccountForm(user) }),
    );
    return parseBody(response, MessageResponseSchema);
  }

  async getUserByEmail(email: string): Promise<UserDetail> {
    const response = await requestResilient(() =>
      this.request.get('/api/getUserDetailByEmail', { params: { email } }),
    );
    return (await parseBody(response, UserDetailResponseSchema)).user;
  }

  async deleteAccount(email: string, password: string): Promise<MessageResponse> {
    const response = await requestResilient(() =>
      this.request.delete('/api/deleteAccount', { form: { email, password } }),
    );
    return parseBody(response, MessageResponseSchema);
  }

  /** Raw access for negative tests (wrong method, missing params). */
  async raw(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, form?: Record<string, string>) {
    const response = await requestResilient(() =>
      this.request.fetch(path, { method, ...(form ? { form } : {}) }),
    );
    return parseBody(response, MessageResponseSchema);
  }
}

function toAccountForm(user: UserData): Record<string, string> {
  return {
    name: user.name,
    email: user.email,
    password: user.password,
    title: user.title,
    birth_date: String(user.birthDate.day),
    birth_month: String(user.birthDate.month),
    birth_year: String(user.birthDate.year),
    firstname: user.firstName,
    lastname: user.lastName,
    company: user.company,
    address1: user.address1,
    address2: user.address2,
    country: user.country,
    zipcode: user.zipcode,
    state: user.state,
    city: user.city,
    mobile_number: user.mobileNumber,
  };
}
