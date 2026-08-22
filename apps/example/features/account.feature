@pickle:state:active
Feature: Customer accounts

  @automation-exercise:1 @external-write
  Scenario: Register a new customer
    Given I am on the Automation Exercise home page
    When I navigate to /login
    Then the "New User Signup!" form should be visible
    When I submit a customer name and a unique disposable email address
    Then the "ENTER ACCOUNT INFORMATION" form should be visible
    When I complete the required account information and opt into both email preferences
    And I complete the required address information and create the account
    Then "ACCOUNT CREATED!" should be visible
    When I continue to the signed-in home page
    Then the navigation should show the registered customer name
    When I delete the account
    Then "ACCOUNT DELETED!" should be visible

  @automation-exercise:2 @external-write @requires-account
  Scenario: Sign in with valid credentials
    Given a disposable registered customer account is available
    And I am on the Automation Exercise home page
    When I navigate to /login
    Then the "Login to your account" form should be visible
    When I submit the disposable account email and password
    Then the navigation should show the signed-in customer name
    When I delete the account
    Then "ACCOUNT DELETED!" should be visible

  @automation-exercise:3
  Scenario: Reject invalid sign-in credentials
    Given I am on the Automation Exercise home page
    When I navigate to /login
    And I sign in with "missing-user@pickle-spec.invalid" and "wrong-password"
    Then "Your email or password is incorrect!" should be visible

  @automation-exercise:4 @requires-account
  Scenario: Sign out a customer
    Given a disposable registered customer account is available
    And I am on the Automation Exercise home page
    When I navigate to /login
    And I sign in with the disposable account email and password
    Then the navigation should show the signed-in customer name
    When I select "Logout"
    Then I should return to the "Signup / Login" page

  @automation-exercise:5 @external-write @requires-account
  Scenario: Reject registration with an existing email address
    Given a disposable registered customer account is available
    And I am on the Automation Exercise home page
    When I navigate to /login
    And I submit a customer name with the existing account email
    Then "Email Address already exist!" should be visible
