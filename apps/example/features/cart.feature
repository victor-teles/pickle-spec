@pickle:state:active
Feature: Shopping cart

  @regression
  Scenario: Customer updates a multi-item cart
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    And I add "Sauce Labs Backpack" to the cart
    And I add "Sauce Labs Bike Light" to the cart
    Then the shopping cart badge should show 2 items
    When I select the shopping cart
    Then the cart should contain "Sauce Labs Backpack" and "Sauce Labs Bike Light"
    When I remove "Sauce Labs Bike Light"
    Then the shopping cart badge should show 1 item
    And the cart should contain only "Sauce Labs Backpack"
    When I click "Continue Shopping"
    Then the "Products" page should be visible
