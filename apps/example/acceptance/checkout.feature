@pickle:state:active
Feature: Synthetic checkout acceptance

  Scenario: Signed-in customer completes one backpack order
    Given I open the synthetic checkout
    When I sign in with the valid acceptance account
    Then the product catalog is visible
    When I add the backpack to the basket
    Then the basket contains one backpack
    When I start checkout
    Then the order summary shows one backpack with a total of $29.99
    When I place the order
    Then the confirmation shows one completed order
