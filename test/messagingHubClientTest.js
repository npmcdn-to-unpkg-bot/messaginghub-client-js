'use strict';

/*eslint-env node, mocha */

import MessagingHubClient from '../src/MessagingHubClient';
import TcpTransport from './helpers/TcpTransport';
import TcpLimeServer from './helpers/TcpLimeServer';

require('chai').should();

describe('MessagingHubClient', function() {

    //
    before((done) => {
        this.server = new TcpLimeServer();
        this.server.listen(8124).then(done);
    });

    after(() => {
        this.server.close();
    });

    //
    beforeEach(() => {
        this.transport = new TcpTransport();
        this.client = new MessagingHubClient('127.0.0.1:8124', this.transport);
    });

    afterEach((done) => {
        this.client.close().then(() => done());
    });

    //
    it('should connect returning a promise', (done) => {
        const clientWithoutIdentifier = new MessagingHubClient('127.0.0.1:8124', new TcpTransport());
        clientWithoutIdentifier.connectWithGuest.bind(clientWithoutIdentifier).should.throw(Error);

        this.client.connectWithGuest('guest').then(() => done());
    });

    it('should connect with plain authentication converting to a base64 password', (done) => {
        const clientWithoutIdentifier = new MessagingHubClient('127.0.0.1:8124', new TcpTransport());
        clientWithoutIdentifier.connectWithPassword.bind(clientWithoutIdentifier).should.throw(Error);

        const clientWithoutPassword = new MessagingHubClient('127.0.0.1:8124', new TcpTransport());
        clientWithoutPassword.connectWithPassword.bind(clientWithoutPassword, 'test2').should.throw(Error);

        this.client.connectWithPassword('test', '123456').then(() => done());
    });

    it('should connect with key authentication', (done) => {
        const clientWithoutIdentifier = new MessagingHubClient('127.0.0.1:8124', new TcpTransport());
        clientWithoutIdentifier.connectWithKey.bind(clientWithoutIdentifier).should.throw(Error);

        const clientWithoutKey = new MessagingHubClient('127.0.0.1:8124', new TcpTransport());
        clientWithoutKey.connectWithKey.bind(clientWithoutKey, 'dGVzdHQy').should.throw(Error);

        this.client.connectWithKey('testKey', 'YWJjZGVm').then(() => done());
    });

    it('should automatically send a set presence command when connecting', (done) => {
        this.server._onPresenceCommand = (command) => {
            command.should.eql({
                id: command.id,
                method: 'set',
                uri: '/presence',
                type: 'application/vnd.lime.presence+json',
                resource: {
                    status: 'available',
                    routingRule: 'identity'
                }
            });
            this.server._onPresenceCommand = () => {};
            done();
        };

        this.client.connectWithGuest('guest2');
    });

    it('should automatically send a set receipt command when connecting', (done) => {
        this.server._onReceiptCommand = (command) => {
            command.should.eql({
                id: command.id,
                method: 'set',
                uri: '/receipt',
                type: 'application/vnd.lime.receipt+json',
                resource: {
                    events: [
                        'failed',
                        'accepted',
                        'dispatched',
                        'received',
                        'consumed'
                    ]
                }
            });
            this.server._onPresenceCommand = () => {};
            done();
        };

        this.client.connectWithGuest('guest2');
    });

    it('should add and remove message listeners', (done) => {
        let f = () => undefined;
        let g = (x) => x;

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => {
                let remove_f = this.client.addMessageReceiver('application/json', f);
                let remove_g = this.client.addMessageReceiver('application/json', g);

                this.client._messageReceivers[0].callback.should.eql(f);
                this.client._messageReceivers[1].callback.should.eql(g);
                remove_f();
                this.client._messageReceivers[0].callback.should.eql(g);
                remove_g();
                this.client._messageReceivers.should.eql([]);

                done();
            });
    });

    it('should add and remove notification listeners', (done) => {
        let f = () => undefined;
        let g = (x) => x;

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => {
                let remove_f = this.client.addNotificationReceiver('received', f);
                let remove_g = this.client.addNotificationReceiver('received', g);

                this.client._notificationReceivers[0].callback.should.eql(f);
                this.client._notificationReceivers[1].callback.should.eql(g);
                remove_f();
                this.client._notificationReceivers[0].callback.should.eql(g);
                remove_g();
                this.client._notificationReceivers.should.eql([]);

                done();
            });
    });

    it('should call receivers predicates with the received envelope', (done) => {
        this.client.addMessageReceiver((message) => {
            message.type.should.equal('text/plain');
            message.content.should.equal('test');
            return true;
        }, () => {
            this.client.addNotificationReceiver((message) => {
                message.event.should.equal('received');
                return true;
            }, () => {
                this.client.clearMessageReceivers();
                this.client.clearNotificationReceivers();
                done();
            });
            this.server.broadcast({ event: 'received' });
        });

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.server.broadcast({ type: 'text/plain', content: 'test' }));
    });

    it('should create predicate functions from non-function values', (done) => {
        this.client.addMessageReceiver(null, () => {
            this.client.clearMessageReceivers();
            this.client.addNotificationReceiver(null, () => {
                this.client.clearNotificationReceivers();
                this.client.addMessageReceiver('text/plain', () => {
                    this.client.clearMessageReceivers();
                    this.client.addNotificationReceiver('received', () => {
                        this.client.clearNotificationReceivers();
                        done();
                    });
                    this.server.broadcast({ event: 'received' });
                });
                this.server.broadcast({ type: 'text/plain', content: 'test' });
            });
            this.server.broadcast({ event: 'received' });
        });

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.server.broadcast({ type: 'text/plain', content: 'test' }));
    });

    it('should do nothing when receiving unknown messages, notifications or commands', (done) => {
        this.client.addMessageReceiver('sometype', () => false);
        this.client.addNotificationReceiver('sometype', () => false);

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => {
                let message = { type: 'application/unknown', content: 'this looks odd' };
                let notification = { event: 'consumed', content: 'this looks odd' };
                let command = { id: 'no_id_for_this', method: 'get' };

                this.server.broadcast(message);
                this.server.broadcast(notification);
                this.server.broadcast(command);

                done();
            });
    });

    it('should send messages', (done) => {
        let remove = this.client.addMessageReceiver('text/plain', (m) => {
            m.content.should.equal('pong');
            remove();
            done();
        });

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.client.sendMessage({ type: 'text/plain', content: 'ping' }));
    });

    it('should send notifications', (done) => {
        let remove = this.client.addNotificationReceiver('pong', () => {
            remove();
            done();
        });

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.client.sendNotification({ event: 'ping' }));
    });

    it('should automatically send received notifications for messages', (done) => {
        this.client.addMessageReceiver(() => true, () => true);
        this.client.addNotificationReceiver('received', () => done());

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.server.broadcast({ type: 'text/plain', content: 'test' }));
    });

    it('should automatically send consumed notifications for messages when receiver successfully handles it', (done) => {
        this.client.addMessageReceiver(() => true, () => true);
        this.client.addNotificationReceiver('consumed', () => done());

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.server.broadcast({ type: 'text/plain', content: 'test' }));
    });

    it('should automatically send failed notifications for messages when receiver fails to handle it', (done) => {
        this.client.addMessageReceiver(() => true, () => {
            throw new Error('test error');
        });
        this.client.addNotificationReceiver('failed', (n) => {
            n.reason.code.should.equal(101);
            n.reason.description.should.equal('test error');
            done();
        });

        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.server.broadcast({ type: 'text/plain', content: 'test' }));
    });

    it('should send commands and receive a response', (done) => {
        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.client.sendCommand({ id: 'test', method: 'get', uri: '/ping' }))
            .then((c) => {
                c.id.should.equal('test');
                c.method.should.equal('get');
                c.status.should.equal('success');
                done();
            });
    });

    it('should reject a command\'s promise when the received status is \'failure\'', (done) => {
        this.client
            .connectWithKey('test', 'YWJjZGVm')
            .then(() => this.client.sendCommand({ id: 'test', method: 'set', uri: '/unknown' }))
            .catch((c) => {
                c.status.should.equal('failure');
                done();
            });
    });
});
