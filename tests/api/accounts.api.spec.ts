import { test, expect } from '@/fixtures';
import { buildUser } from '@/data/user.factory';

test.describe('Accounts API', { tag: ['@api'] }, () => {
  test(
    'account lifecycle keeps data consistent across create, read, update and delete',
    { tag: '@smoke' },
    async ({ aeApi }) => {
      const user = buildUser();

      await test.step('create', async () => {
        expect(await aeApi.createAccount(user)).toEqual({ responseCode: 201, message: 'User created!' });
      });

      await test.step('read back what was written', async () => {
        const stored = await aeApi.getUserByEmail(user.email);
        expect(stored).toMatchObject({
          name: user.name,
          email: user.email,
          first_name: user.firstName,
          last_name: user.lastName,
          city: user.city,
          country: user.country,
          zipcode: user.zipcode,
        });
      });

      await test.step('credentials are accepted', async () => {
        expect(await aeApi.verifyLogin(user.email, user.password)).toEqual({
          responseCode: 200,
          message: 'User exists!',
        });
      });

      await test.step('update is persisted', async () => {
        const updated = { ...user, city: 'Ottawa', company: 'Updated Co' };
        expect(await aeApi.updateAccount(updated)).toEqual({ responseCode: 200, message: 'User updated!' });
        expect(await aeApi.getUserByEmail(user.email)).toMatchObject({
          city: 'Ottawa',
          company: 'Updated Co',
        });
      });

      await test.step('delete removes the account everywhere', async () => {
        expect(await aeApi.deleteAccount(user.email, user.password)).toEqual({
          responseCode: 200,
          message: 'Account deleted!',
        });
        expect((await aeApi.verifyLogin(user.email, user.password)).responseCode).toBe(404);
        expect(
          (await aeApi.raw('GET', `/api/getUserDetailByEmail?email=${encodeURIComponent(user.email)}`))
            .responseCode,
        ).toBe(404);
      });
    },
  );

  test(
    'registering an existing e-mail is rejected',
    { tag: '@regression' },
    async ({ aeApi, registeredUser }) => {
      expect(await aeApi.createAccount({ ...registeredUser, name: 'Someone Else' })).toEqual({
        responseCode: 400,
        message: 'Email already exists!',
      });
    },
  );

  test('verifyLogin rejects a wrong password', { tag: '@regression' }, async ({ aeApi, registeredUser }) => {
    expect(await aeApi.verifyLogin(registeredUser.email, 'wrong-password')).toEqual({
      responseCode: 404,
      message: 'User not found!',
    });
  });

  test('verifyLogin without email returns 400', { tag: '@regression' }, async ({ aeApi }) => {
    expect(await aeApi.raw('POST', '/api/verifyLogin', { password: 'x' })).toEqual({
      responseCode: 400,
      message: 'Bad request, email or password parameter is missing in POST request.',
    });
  });

  test('DELETE verifyLogin is rejected with 405', { tag: '@regression' }, async ({ aeApi }) => {
    expect((await aeApi.raw('DELETE', '/api/verifyLogin')).responseCode).toBe(405);
  });

  test(
    'an account cannot be deleted without its password',
    { tag: '@regression' },
    async ({ aeApi, registeredUser }) => {
      expect(await aeApi.deleteAccount(registeredUser.email, 'not-the-password')).toEqual({
        responseCode: 404,
        message: 'Account not found!',
      });
      // Authorization check: the account must survive the unauthorised delete attempt.
      expect((await aeApi.verifyLogin(registeredUser.email, registeredUser.password)).responseCode).toBe(200);
    },
  );

  test('createAccount with missing fields returns 400', { tag: '@regression' }, async ({ aeApi }) => {
    const response = await aeApi.raw('POST', '/api/createAccount', { email: buildUser().email });
    expect(response).toEqual({
      responseCode: 400,
      message: 'Bad request, name parameter is missing in POST request.',
    });
  });

  test(
    'createAccount ignores a JSON body and reports missing form fields',
    { tag: '@regression' },
    async ({ request }) => {
      const response = await request.post('/api/createAccount', { data: buildUser() });
      expect(await response.json()).toEqual({
        responseCode: 400,
        message: 'Bad request, name parameter is missing in POST request.',
      });
    },
  );

  test(
    'getUserDetailByEmail validates its parameter and unknown users',
    { tag: '@regression' },
    async ({ aeApi }) => {
      expect((await aeApi.raw('GET', '/api/getUserDetailByEmail')).responseCode).toBe(400);
      expect(
        (await aeApi.raw('GET', `/api/getUserDetailByEmail?email=${encodeURIComponent(buildUser().email)}`))
          .responseCode,
      ).toBe(404);
    },
  );

  test('updating a non-existent account returns 404', { tag: '@regression' }, async ({ aeApi }) => {
    expect((await aeApi.updateAccount(buildUser())).responseCode).toBe(404);
  });

  test(
    'concurrent registrations with the same e-mail create exactly one account',
    { tag: '@regression' },
    async ({ aeApi }) => {
      const user = buildUser();
      try {
        const results = await Promise.all(Array.from({ length: 4 }, () => aeApi.createAccount(user)));
        const codes = results.map((r) => r.responseCode).sort();
        expect(codes).toEqual([201, 400, 400, 400]);
      } finally {
        await aeApi.deleteAccount(user.email, user.password);
      }
    },
  );
});
