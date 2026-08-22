@pickle:state:active
Feature: Backpack checkout

  @smoke @regression
  Scenario: Standard customer completes a backpack order
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    Then the "Products" page should be visible
    When I add "Sauce Labs Backpack" to the cart
    And I select the shopping cart
    Then the "Your Cart" page should contain 1 "Sauce Labs Backpack"
    When I click "Checkout"
    Then "Checkout: Your Information" should be visible
    When I fill "First Name" with "Sauce"
    And I fill "Last Name" with "Demo"
    And I fill "Zip/Postal Code" with "94105"
    And I click "Continue"
    Then "Checkout: Overview" should be visible
    And the order summary should contain 1 "Sauce Labs Backpack"
    And the payment, shipping, and price total sections should be visible
    When I click "Finish"
    Then "Checkout: Complete!" should be visible
    And "Thank you for your order!" should be visible

  @regression
  Scenario: Checkout requires complete customer information
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    And I add "Sauce Labs Backpack" to the cart
    And I select the shopping cart
    And I click "Checkout"
    Then "Checkout: Your Information" should be visible
    When I click "Continue" without entering customer information
    Then "Error: First Name is required" should be visible
    When I fill "First Name" with "Sauce"
    And I click "Continue"
    Then "Error: Last Name is required" should be visible
    When I fill "Last Name" with "Demo"
    And I click "Continue"
    Then "Error: Postal Code is required" should be visible

  @regression
  Scenario: Customer cancels checkout before entering information
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    And I add "Sauce Labs Backpack" to the cart
    And I select the shopping cart
    And I click "Checkout"
    Then "Checkout: Your Information" should be visible
    When I click "Cancel"
    Then the "Your Cart" page should be visible
    And the cart should contain 1 "Sauce Labs Backpack"
