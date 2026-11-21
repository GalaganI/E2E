@ui
Feature: Checkout
  As a registered customer
  I want to buy products and get a confirmation
  So that I know my order has been accepted

  Background:
    Given Quinn is a registered customer who is logged in

  @smoke
  Scenario: Customer buys several products
    When Quinn adds the following products to the cart:
      | productId | quantity |
      | 1         | 2        |
      | 6         | 1        |
    And Quinn proceeds to checkout
    Then the order summary lists the cart products with a matching total
    When Quinn pays with a valid card
    Then Quinn sees the order confirmation for the order total
    And Quinn's cart is empty

  @regression
  Scenario: Customer's cart is kept for a later visit
    When Quinn adds the following products to the cart:
      | productId | quantity |
      | 3         | 1        |
    Then Quinn's cart contains product 3 with quantity 1
