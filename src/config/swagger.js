const swaggerJsdoc = require('swagger-jsdoc');

const package = require('../../package.json');
const authSwagger = require('../swaggers/auth.swagger');
const messageSwagger = require('../swaggers/message.swagger');
const userSwagger = require('../swaggers/user.swagger');
const friendSwagger = require('../swaggers/friend.swagger');
const conversationSwagger = require('../swaggers/conversation.swagger');
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: package.name,
            version: package.version,
            description: package.description,
        },
        servers: [
            {
                url: process.env.URL_API,
                description: process.env.ENVIRONMENT,
            },
        ],
        tags: ['Auth', 'Message', 'User'],
        paths: {
            ...authSwagger,
            ...messageSwagger,
            ...userSwagger,
            ...conversationSwagger,
            ...friendSwagger,
        },
        components: {
            /* ... */
            securitySchemes: {
                accessToken: {
                    type: 'http',
                    scheme: 'bearer',
                    in: 'header',
                    bearerFormat: 'JWT',
                    description: "Enter the token don't need the `Bearer: ` prefix, e.g. 'abcde12345'.",
                },
            },
        },
    },
    apis: ['./routes/*.js'],
};

module.exports = swaggerJsdoc(options);
