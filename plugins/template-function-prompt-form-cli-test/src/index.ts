export const plugin = {
  templateFunctions: [
    {
      name: 'prompt.form.demo',
      description: 'Prompt for a few values using prompt.form and return a JSON string',
      args: [],
      async onRender(ctx, args) {
        if (args.purpose !== 'send') {
          return null;
        }

        const values = await ctx.prompt.form({
          id: 'prompt-form-demo',
          title: 'CLI Prompt Form Demo',
          description: 'Fill out the fields to test prompt.form in the CLI.',
          inputs: [
            {
              type: 'text',
              name: 'username',
              label: 'Username',
              defaultValue: 'alice'
            },
            {
              type: 'text',
              name: 'password',
              label: 'Password',
              password: true,
              optional: true
            },
            {
              type: 'select',
              name: 'region',
              label: 'Region',
              defaultValue: 'us',
              options: [
                { label: 'US', value: 'us' },
                { label: 'EU', value: 'eu' },
                { label: 'APAC', value: 'apac' }
              ]
            },
            {
              type: 'checkbox',
              name: 'remember',
              label: 'Remember',
              defaultValue: 'true',
              optional: true
            }
          ]
        });

        if (values == null) {
          throw new Error('Prompt form cancelled');
        }

        return JSON.stringify(values);
      }
    }
  ]
};
