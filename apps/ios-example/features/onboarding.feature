@pickle:state:active
Feature: iOS onboarding

  @smoke
  Scenario: Customer opens the home screen
    Given Welcome
    When Continue
    Then visible: text="Home"
