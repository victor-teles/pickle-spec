@pickle:state:active
Feature: Customer authentication

  @smoke @regression
  Scenario: Standard customer signs in to the product catalog
    Given I am on the SauceDemo login page
    When I fill "Username" with "standard_user"
    And I fill "Password" with "secret_sauce"
    And I click "Login"
    Then the "Products" page should be visible
    And "Sauce Labs Backpack" should be listed

  @regression
  Scenario: Locked-out customer cannot sign in
    Given I am on the SauceDemo login page
    When I sign in with "locked_out_user" and "secret_sauce"
    Then "Epic sadface: Sorry, this user has been locked out." should be visible
    And the "Username" and "Password" fields should remain visible

  @regression
  Scenario: Login requires both credentials
    Given I am on the SauceDemo login page
    When I click "Login" without entering credentials
    Then "Epic sadface: Username is required" should be visible
    When I fill "Username" with "standard_user"
    And I click "Login" without entering a password
    Then "Epic sadface: Password is required" should be visible

  @regression
  Scenario: Signed-in customer logs out
    Given I am on the SauceDemo login page
    When I sign in with "standard_user" and "secret_sauce"
    Then the "Products" page should be visible
    When I select the menu button
    And I select "Logout"
    Then the SauceDemo login page should be visible
    And the "Username" and "Password" fields should be visible
