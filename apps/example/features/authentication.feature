@pickle:state:active
Feature: Customer authentication

  @smoke
  Scenario: Standard customer signs in to the product catalog
    Given I am on the SauceDemo login page
    When I fill "Username" with "standard_user"
    And I fill "Password" with "secret_sauce"
    And I click "Login"
    Then the "Products" page should be visible
    And "Sauce Labs Backpack" should be listed
