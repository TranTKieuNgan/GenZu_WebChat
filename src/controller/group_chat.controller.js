const { ObjectId } = require('mongodb');

const Conversation = require('../model/conversation.model');
const Message = require('../model/message.model');
const { STATUS_CODE, STATUS_MESSAGE, MESSAGE_CODE } = require('@/enums/response');
const { createResponse, responseNotificationSocket } = require('@/utils/responseHelper');

module.exports = {
    createGroupChat: async (data, socket) => {
        const userId = socket.user._id;
        const users = data.users;
        let latestMessage;

        try {
            const groupChat = await Conversation.create({
                chatName: data.chatName,
                avatar: data.avatar,
                background: data.background,
                isGroupChat: true,
                users: [userId, ...users],
                groupAdmin: userId,
            });
            groupChat.users.forEach((item) => {
                socket
                    .in(item.toString())
                    .emit(
                        'notification',
                        responseNotificationSocket(groupChat, MESSAGE_CODE.ADD_MEMBER_TO_GROUP_SUCCESSFULLY, true),
                    );
            });
            users.forEach(async (item) => {
                latestMessage = await Message.create({
                    sender: userId,
                    message: MESSAGE_CODE.ADD_MEMBER_TO_GROUP_SUCCESSFULLY,
                    conversation: groupChat,
                    status: 'active',
                    affected_user_id: item,
                    messageType: 'notification',
                });
            });
            const fullGroupChatInfo = await Conversation.findByIdAndUpdate(
                groupChat._id,
                { latestMessage },
                { new: true },
            )
                .populate('users', 'picture fullName _id email is_online offline_at')
                .populate('groupAdmin', 'picture fullName _id email is_online offline_at');

            return socket.emit(
                'response group',
                createResponse(
                    fullGroupChatInfo,
                    STATUS_MESSAGE.CREATE_GROUP_SUCCESSFULLY,
                    MESSAGE_CODE.CREATE_GROUP_SUCCESSFULLY,
                    STATUS_CODE.CREATED,
                    true,
                ),
            );
        } catch (error) {
            return socket.emit(
                'response group',
                createResponse(
                    error,
                    STATUS_MESSAGE.INTERNAL_SERVER_ERROR,
                    null,
                    STATUS_CODE.INTERNAL_SERVER_ERROR,
                    false,
                ),
            );
        }
    },
    addMemberGroupChat: async (data, socket) => {
        const groupId = data.groupId;
        const newUsers = data.users;
        const userId = socket.user._id;
        let latestMessage;

        try {
            const group = await Conversation.findById(groupId);
            if (!group) {
                return socket.emit(
                    'response group',
                    createResponse(
                        null,
                        STATUS_MESSAGE.GROUP_NOT_FOUND,
                        MESSAGE_CODE.GROUP_NOT_FOUND,
                        STATUS_CODE.NOT_FOUND,
                        false,
                    ),
                );
            }

            const currentUsersSet = new Set(group.users.map((user) => user.toString()));
            const duplicateUsers = newUsers.filter((user) => currentUsersSet.has(user.toString()));

            if (duplicateUsers.length > 0) {
                return socket.emit(
                    'response group',
                    createResponse(
                        duplicateUsers,
                        STATUS_MESSAGE.MEMBER_ALREADY_EXIST_IN_GROUP,
                        MESSAGE_CODE.MEMBER_ALREADY_EXIST_IN_GROUP,
                        STATUS_CODE.CONFLICT,
                        false,
                    ),
                );
            }

            newUsers.forEach(async (item) => {
                latestMessage = await Message.create({
                    sender: userId,
                    message: MESSAGE_CODE.ADD_MEMBER_TO_GROUP_SUCCESSFULLY,
                    conversation: group._id,
                    status: 'active',
                    affected_user_id: item,
                    messageType: 'notification',
                });
                socket
                    .in(group._id.toString())
                    .emit(
                        'message received',
                        responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                    );
            });

            const newGroup = await Conversation.findByIdAndUpdate(
                { _id: group._id },
                { $push: { users: { $each: newUsers } }, $set: { latestMessage } },
                { new: true },
            )
                .populate('users', 'picture fullName _id email is_online offline_at')
                .populate('groupAdmin', 'picture fullName _id email is_online offline_at');

            newUsers.forEach((item) => {
                socket
                    .in(item.toString())
                    .emit(
                        'notification',
                        responseNotificationSocket(newGroup, MESSAGE_CODE.ADD_MEMBER_TO_GROUP_SUCCESSFULLY, true),
                    );
            });

            return socket.emit(
                'response group',
                createResponse(
                    newGroup,
                    STATUS_MESSAGE.ADD_MEMBER_TO_GROUP_SUCCESSFULLY,
                    MESSAGE_CODE.ADD_MEMBER_TO_GROUP_SUCCESSFULLY,
                    STATUS_CODE.OK,
                    true,
                ),
            );
        } catch (error) {
            return socket.emit(
                'response group',
                createResponse(
                    error,
                    STATUS_MESSAGE.INTERNAL_SERVER_ERROR,
                    null,
                    STATUS_CODE.INTERNAL_SERVER_ERROR,
                    false,
                ),
            );
        }
    },
    deleteMemberGroupChat: async (data, socket) => {
        const groupId = data.groupId;
        const userId = socket.user._id;
        const exchangeAdminId = new ObjectId(data.exchangeAdmin);
        const memberId = new ObjectId(data.memberId);

        try {
            const group = await Conversation.findById(groupId);
            let userDeleteInGroup;
            let memberIsExis;

            if (!group) {
                return socket.emit(
                    'response group',
                    createResponse(
                        null,
                        STATUS_MESSAGE.GROUP_NOT_FOUND,
                        MESSAGE_CODE.GROUP_NOT_FOUND,
                        STATUS_CODE.NOT_FOUND,
                        false,
                    ),
                );
            }

            group.users.forEach((item) => {
                if (item.equals(memberId)) {
                    memberIsExis = item;
                }
                if (item.equals(userId)) {
                    userDeleteInGroup = item;
                }
            });

            if (!userDeleteInGroup) {
                return socket.emit(
                    'response group',
                    createResponse(
                        null,
                        STATUS_MESSAGE.USER_NOT_IN_GROUP,
                        MESSAGE_CODE.USER_NOT_IN_GROUP,
                        STATUS_CODE.FORBIDDEN,
                        false,
                    ),
                );
            }

            if (!memberIsExis) {
                return socket.emit(
                    'response group',
                    createResponse(
                        null,
                        STATUS_MESSAGE.MEMBER_NOT_FOUND,
                        MESSAGE_CODE.MEMBER_NOT_FOUND,
                        STATUS_CODE.NOT_FOUND,
                        false,
                    ),
                );
            }

            if (!userId.equals(group.groupAdmin)) {
                // not admin and delete others
                if (!userId.equals(memberId)) {
                    return socket.emit(
                        'response group',
                        createResponse(null, STATUS_MESSAGE.FORBIDDEN, null, STATUS_CODE.FORBIDDEN, false),
                    );
                    // not admin and delete self
                } else {
                    const newMembers = group.users.filter((item) => !item.equals(userId));
                    const latestMessage = await Message.create({
                        sender: userId,
                        message: MESSAGE_CODE.USER_LEAVE_IN_GROUP,
                        conversation: group._id,
                        status: 'active',
                        affected_user_id: userId,
                        messageType: 'notification',
                    });

                    const newGroup = await Conversation.findByIdAndUpdate(
                        { _id: group._id },
                        { users: newMembers, latestMessage },
                        { new: true },
                    )
                        .populate('users', 'picture fullName _id email is_online offline_at')
                        .populate('groupAdmin', 'picture fullName _id email is_online offline_at');

                    socket
                        .in(group._id.toString())
                        .emit(
                            'message received',
                            responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                        );

                    return socket.emit(
                        'response group',
                        createResponse(
                            newGroup,
                            STATUS_MESSAGE.DELETE_MEMBER_SUCCESSFULLY,
                            MESSAGE_CODE.DELETE_MEMBER_SUCCESSFULLY,
                            STATUS_CODE.OK,
                            true,
                        ),
                    );
                }
            } else {
                // la admin xoa nguoi khac
                if (!userId.equals(memberId)) {
                    const newMembers = group.users.filter((item) => !item.equals(memberId));
                    const latestMessage = await Message.create({
                        sender: userId,
                        message: MESSAGE_CODE.DELETE_USER_IN_GROUP,
                        conversation: group._id,
                        status: 'active',
                        affected_user_id: memberId,
                        messageType: 'notification',
                    });
                    const newGroup = await Conversation.findByIdAndUpdate(
                        { _id: group._id },
                        { users: newMembers, latestMessage },
                        { new: true },
                    )
                        .populate('users', 'picture fullName _id email is_online offline_at')
                        .populate('groupAdmin', 'picture fullName _id email is_online offline_at');

                    socket
                        .in(group._id.toString())
                        .emit(
                            'message received',
                            responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                        );

                    return socket.emit(
                        'response group',
                        createResponse(
                            newGroup,
                            STATUS_MESSAGE.DELETE_MEMBER_SUCCESSFULLY,
                            MESSAGE_CODE.DELETE_MEMBER_SUCCESSFULLY,
                            STATUS_CODE.OK,
                            true,
                        ),
                    );
                } else {
                    // la admin xoa chinh minh
                    if (!data.exchangeAdmin) {
                        return socket.emit(
                            'response group',
                            createResponse(
                                null,
                                STATUS_MESSAGE.EXCHANGE_ADMIN_ID_REQUIRED,
                                MESSAGE_CODE.EXCHANGE_ADMIN_ID_REQUIRED,
                                STATUS_CODE.BAD_REQUEST,
                                false,
                            ),
                        );
                    }

                    const userExist = group.users.find((item) => item.equals(exchangeAdminId));

                    if (!userExist) {
                        return socket.emit(
                            'response group',
                            createResponse(
                                null,
                                STATUS_MESSAGE.MEMBER_NOT_FOUND,
                                MESSAGE_CODE.MEMBER_NOT_FOUND,
                                STATUS_CODE.NOT_FOUND,
                                false,
                            ),
                        );
                    }

                    // if users have more than 2 members
                    if (group.users.length > 1) {
                        // update groupAdmin to new user
                        group.groupAdmin = exchangeAdminId;
                        const transferLeaderMs = await Message.create({
                            sender: userId,
                            message: MESSAGE_CODE.TRANSFER_GROUP_LEADER,
                            conversation: group._id,
                            status: 'active',
                            affected_user_id: exchangeAdminId,
                            messageType: 'notification',
                        });

                        socket
                            .in(group._id.toString())
                            .emit(
                                'message received',
                                responseNotificationSocket(
                                    transferLeaderMs,
                                    MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY,
                                    true,
                                ),
                            );

                        // delete self from the group
                        group.users.pull(memberId);
                        const latestMessage = await Message.create({
                            sender: userId,
                            message: MESSAGE_CODE.USER_LEAVE_IN_GROUP,
                            conversation: group._id,
                            status: 'active',
                            affected_user_id: userId,
                            messageType: 'notification',
                        });

                        group.latestMessage = latestMessage;
                        await group.save();

                        socket
                            .in(group._id.toString())
                            .emit(
                                'message received',
                                responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                            );

                        return socket.emit(
                            'response group',
                            createResponse(
                                null,
                                STATUS_MESSAGE.USER_LEAVE_IN_GROUP,
                                MESSAGE_CODE.USER_LEAVE_IN_GROUP,
                                STATUS_CODE.OK,
                                true,
                            ),
                        );

                        // if users have less than 2 members
                    } else {
                        // delete group
                        await Conversation.deleteOne({ _id: group._id });
                        return socket.emit(
                            'response group',
                            createResponse(
                                null,
                                STATUS_MESSAGE.DELETE_GROUP_SUCCESSFULLY,
                                MESSAGE_CODE.DELETE_GROUP_SUCCESSFULLY,
                                STATUS_CODE.OK,
                                true,
                            ),
                        );
                    }
                }
            }
        } catch (error) {
            return socket.emit(
                'response group',
                createResponse(
                    error,
                    STATUS_MESSAGE.INTERNAL_SERVER_ERROR,
                    null,
                    STATUS_CODE.INTERNAL_SERVER_ERROR,
                    false,
                ),
            );
        }
    },
    updateGroupChat: async (data, socket) => {
        const userId = socket.user._id;
        const groupId = data.groupId;

        try {
            const group = await Conversation.findById(groupId);

            let latestMessage;

            if (data.avatar) {
                group.avatar = data.avatar;
                latestMessage = await Message.create({
                    sender: userId,
                    message: MESSAGE_CODE.CHANGE_AVATAR,
                    conversation: groupId,
                    status: 'active',
                    messageType: 'notification',
                });
                socket
                    .in(group._id.toString())
                    .emit(
                        'message received',
                        responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                    );
            }

            if (data.background) {
                group.background = data.background;
                latestMessage = await Message.create({
                    sender: userId,
                    message: MESSAGE_CODE.CHANGE_BACKGROUND,
                    conversation: groupId,
                    status: 'active',
                    messageType: 'notification',
                });
                socket
                    .in(group._id.toString())
                    .emit(
                        'message received',
                        responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                    );
            }

            if (data.chatName) {
                latestMessage = await Message.create({
                    sender: userId,
                    message: `${MESSAGE_CODE.CHANGE_NAME} ${group.chatName} ${data.chatName}`,
                    conversation: groupId,
                    status: 'active',
                    messageType: 'notification',
                });
                group.chatName = data.chatName;
                socket
                    .in(group._id.toString())
                    .emit(
                        'message received',
                        responseNotificationSocket(latestMessage, MESSAGE_CODE.SEND_MESSAGE_SUCCESSFULLY, true),
                    );
            }

            group.latestMessage = latestMessage;

            const newGroup = await group.save();

            const resGroup = await Conversation.findById(newGroup._id)
                .populate('users', 'picture fullName _id email is_online offline_at')
                .populate('groupAdmin', 'picture fullName _id email is_online offline_at');
            return socket.emit(
                'response group',
                createResponse(
                    resGroup,
                    STATUS_MESSAGE.UPDATE_GROUP_SUCCESSFULLY,
                    MESSAGE_CODE.UPDATE_GROUP_SUCCESSFULLY,
                    STATUS_CODE.OK,
                    true,
                ),
            );
        } catch (error) {
            return socket.emit(
                'response group',
                createResponse(
                    error,
                    STATUS_MESSAGE.INTERNAL_SERVER_ERROR,
                    null,
                    STATUS_CODE.INTERNAL_SERVER_ERROR,
                    false,
                ),
            );
        }
    },
    deleteGroupChat: async (data, socket) => {
        const userId = socket.user._id;
        const groupId = data.id;

        try {
            const group = await Conversation.findById(groupId);

            if (!group) {
                socket.emit(
                    'response group',
                    createResponse(
                        null,
                        STATUS_MESSAGE.GROUP_NOT_FOUND,
                        MESSAGE_CODE.GROUP_NOT_FOUND,
                        STATUS_CODE.NOT_FOUND,
                        false,
                    ),
                );
            }

            if (!userId.equals(group.groupAdmin)) {
                socket.emit(
                    'response group',
                    createResponse(
                        null,
                        STATUS_MESSAGE.FORBIDDEN,
                        MESSAGE_CODE.FORBIDDEN,
                        STATUS_CODE.FORBIDDEN,
                        false,
                    ),
                );
            }

            await Conversation.deleteOne({ _id: group._id });

            group.users.forEach((item) => {
                socket
                    .in(item.toString())
                    .emit(
                        'notification',
                        responseNotificationSocket(group._id, MESSAGE_CODE.DELETE_GROUP_SUCCESSFULLY, true),
                    );
            });

            return socket.emit(
                'response group',
                createResponse(
                    group._id,
                    STATUS_MESSAGE.DELETE_GROUP_SUCCESSFULLY,
                    MESSAGE_CODE.DELETE_GROUP_SUCCESSFULLY,
                    STATUS_CODE.OK,
                    true,
                ),
            );
        } catch (error) {
            return socket.emit(
                'response group',
                createResponse(
                    error,
                    STATUS_MESSAGE.INTERNAL_SERVER_ERROR,
                    null,
                    STATUS_CODE.INTERNAL_SERVER_ERROR,
                    false,
                ),
            );
        }
    },
};
