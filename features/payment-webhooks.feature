@integration
Feature: Payment confirmation through webhooks
  The shop marks orders as paid only from signed provider webhooks.
  Webhooks can arrive late, twice or out of order; the order state must stay consistent
  and the customer must receive exactly one confirmation e-mail.
  (Runs against the local payment simulator; no real payments are made.)

  Background:
    Given an order awaiting payment

  @smoke
  Scenario Outline: Payment outcome is reflected on the order
    When the customer pays with the "<card>" test card
    Then the order status becomes "<status>"
    And the customer receives an e-mail with subject starting "<subject>"

    Examples:
      | card     | status         | subject         |
      | success  | paid           | Order           |
      | declined | payment_failed | Payment failed  |

  @regression
  Scenario: Duplicate and out-of-order webhook deliveries
    Given the provider has confirmed the payment
    When the "succeeded" event is delivered again
    And a stale "processing" event arrives late
    Then the order is still "paid"
    And exactly one confirmation e-mail was sent

  @regression
  Scenario: Merchant back-end outage during webhook delivery
    Given the merchant back-end fails the next 2 webhook deliveries
    When the customer pays with the "success" test card
    Then the order status becomes "paid"
    And the provider made 3 delivery attempts
