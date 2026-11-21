import { mergeTests } from '@playwright/test';
import { createBdd, test as bddBase } from 'playwright-bdd';
import { test as frameworkTest } from '@/fixtures';

/* The framework fixtures stay library-agnostic; only the BDD layer merges in playwright-bdd. */
export const test = mergeTests(bddBase, frameworkTest);
export const { Given, When, Then } = createBdd(test);
