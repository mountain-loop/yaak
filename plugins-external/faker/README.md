# Yaak Faker Plugin

This is a template function that generates realistic fake data
for testing and development using [FakerJS](https://fakerjs.dev).

![CleanShot 2024-09-19 at 13 56 33@2x](https://github.com/user-attachments/assets/2f935110-4af2-4236-a50d-18db5454176d)

## Example JSON Body

Here's an example JSON body that uses fake data:

```json
{
  "id": "${[ faker.string.uuid() ]}",
  "name": "${[ faker.person.fullName() ]}",
  "email": "${[ faker.internet.email() ]}",
  "phone": "${[ faker.phone.number() ]}",
  "address": {
    "street": "${[ faker.location.streetAddress() ]}",
    "city": "${[ faker.location.city() ]}",
    "country": "${[ faker.location.country() ]}",
    "zipCode": "${[ faker.location.zipCode() ]}"
  },
  "company": "${[ faker.company.name() ]}",
  "website": "${[ faker.internet.url() ]}"
}
```

This will generate a random JSON body on every request:

```json
{
  "id": "589f0aec-7310-4bf2-81c4-0b1bb7f1c3c1",
  "name": "Lucy Gottlieb-Weissnat",
  "email": "Destiny_Herzog@gmail.com",
  "phone": "411.805.2871 x699",
  "address": {
    "street": "846 Christ Mills",
    "city": "Spencerfurt",
    "country": "United Kingdom",
    "zipCode": "20354"
  },
  "company": "Emard, Kohler and Rutherford",
  "website": "https://watery-detective.org"
}
```

## Available Categories

The plugin provides access to all FakerJS modules and their methods:

| Category   | Description               | Example Methods                            |
|------------|---------------------------|--------------------------------------------|
| `airline`  | Airline-related data      | `aircraftType`, `airline`, `airplane`      |
| `animal`   | Animal names and types    | `bear`, `bird`, `cat`, `dog`, `fish`       |
| `color`    | Colors in various formats | `human`, `rgb`, `hex`, `hsl`               |
| `commerce` | E-commerce data           | `department`, `product`, `price`           |
| `company`  | Company information       | `name`, `catchPhrase`, `bs`                |
| `database` | Database-related data     | `column`, `type`, `collation`              |
| `date`     | Date and time values      | `recent`, `future`, `past`, `between`      |
| `finance`  | Financial data            | `account`, `amount`, `currency`            |
| `git`      | Git-related data          | `branch`, `commitEntry`, `commitSha`       |
| `hacker`   | Tech/hacker terminology   | `abbreviation`, `noun`, `phrase`           |
| `image`    | Image URLs and data       | `avatar`, `url`, `dataUri`                 |
| `internet` | Internet-related data     | `email`, `url`, `ip`, `userAgent`          |
| `location` | Geographic data           | `city`, `country`, `latitude`, `longitude` |
| `lorem`    | Lorem ipsum text          | `word`, `sentence`, `paragraph`            |
| `person`   | Personal information      | `firstName`, `lastName`, `fullName`        |
| `music`    | Music-related data        | `genre`, `songName`, `artist`              |
| `number`   | Numeric data              | `int`, `float`, `binary`, `hex`            |
| `phone`    | Phone numbers             | `number`, `imei`                           |
| `science`  | Scientific data           | `chemicalElement`, `unit`                  |
| `string`   | String utilities          | `uuid`, `alpha`, `alphanumeric`            |
| `system`   | System-related data       | `fileName`, `mimeType`, `fileExt`          |
| `vehicle`  | Vehicle information       | `vehicle`, `manufacturer`, `model`         |
| `word`     | Word generation           | `adjective`, `adverb`, `conjunction`       |
