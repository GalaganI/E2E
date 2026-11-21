import { z } from 'zod';

/*
 * Response contracts for the public Automation Exercise API (https://automationexercise.com/api_list).
 * The API always answers HTTP 200 and reports the outcome in `responseCode`, so the
 * contract check covers both the envelope and the payload.
 */

export const ProductSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.string().regex(/^Rs\. \d+$/),
  brand: z.string().min(1),
  category: z.strictObject({
    usertype: z.strictObject({ usertype: z.enum(['Women', 'Men', 'Kids']) }),
    category: z.string().min(1),
  }),
});

export const ProductsResponseSchema = z.strictObject({
  responseCode: z.literal(200),
  products: z.array(ProductSchema),
});

export const BrandsResponseSchema = z.strictObject({
  responseCode: z.literal(200),
  brands: z.array(z.strictObject({ id: z.number().int().positive(), brand: z.string().min(1) })),
});

export const MessageResponseSchema = z.strictObject({
  responseCode: z.number().int(),
  message: z.string(),
});

export const UserDetailSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string(),
  email: z.email(),
  title: z.string(),
  birth_day: z.string(),
  birth_month: z.string(),
  birth_year: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  company: z.string(),
  address1: z.string(),
  address2: z.string(),
  country: z.string(),
  state: z.string(),
  city: z.string(),
  zipcode: z.string(),
});

export const UserDetailResponseSchema = z.strictObject({
  responseCode: z.literal(200),
  user: UserDetailSchema,
});

export type Product = z.infer<typeof ProductSchema>;
export type UserDetail = z.infer<typeof UserDetailSchema>;
export type MessageResponse = z.infer<typeof MessageResponseSchema>;
