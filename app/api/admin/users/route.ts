import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers: corsHeaders });
}

function verifyAdminToken(request: NextRequest): string | null {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
        if (decoded.role !== 'admin') {
            return null;
        }
        return decoded.userId;
    } catch (error) {
        return null;
    }
}

// GET - List all users with filters and pagination
export async function GET(request: NextRequest) {
    try {
        const adminId = verifyAdminToken(request);
        if (!adminId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401, headers: corsHeaders }
            );
        }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const search = searchParams.get('search');

        const skip = (page - 1) * limit;

        const where: any = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    email: true,
                    name: true,
                    phone: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                    subscriptionType: true,
                    subscriptionEndsAt: true,
                    referralCode: true,
                    referralWalletPaise: true,
                    referralLifetimeEarnedPaise: true,
                    referralCount: true,
                    referredBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            referralCode: true,
                        },
                    },
                    _count: {
                        select: {
                            vehicles: true,
                            sentReferrals: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.user.count({ where }),
        ]);

        return NextResponse.json(
            {
                users,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit),
                },
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error('Get users error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders }
        );
    }
}

// PUT - Update user details (subscription)
export async function PUT(request: NextRequest) {
    try {
        const adminId = verifyAdminToken(request);
        if (!adminId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401, headers: corsHeaders }
            );
        }

        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('id');

        if (!userId) {
            return NextResponse.json(
                { error: 'User ID is required' },
                { status: 400, headers: corsHeaders }
            );
        }

        const body = await request.json();
        const { subscriptionType, subscriptionEndsAt } = body;

        const data: any = {};
        if (subscriptionType !== undefined) data.subscriptionType = subscriptionType;
        if (subscriptionEndsAt !== undefined) data.subscriptionEndsAt = subscriptionEndsAt ? new Date(subscriptionEndsAt) : null;

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data,
            select: {
                id: true,
                name: true,
                email: true,
                subscriptionType: true,
                subscriptionEndsAt: true,
            },
        });

        return NextResponse.json(
            { user: updatedUser, message: 'User updated successfully' },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error('Update user error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders }
        );
    }
}

// DELETE - Delete user
export async function DELETE(request: NextRequest) {
    try {
        const adminId = verifyAdminToken(request);
        if (!adminId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401, headers: corsHeaders }
            );
        }

        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('id');

        if (!userId) {
            return NextResponse.json(
                { error: 'User ID is required' },
                { status: 400, headers: corsHeaders }
            );
        }

        // Delete user
        await prisma.user.delete({
            where: { id: userId },
        });

        // Log activity
        await prisma.activityLog.create({
            data: {
                adminId,
                action: 'user_deleted',
                description: `User ${userId} deleted by admin`,
            },
        });

        return NextResponse.json(
            { message: 'User deleted successfully' },
            { status: 200, headers: corsHeaders }
        );
    } catch (error) {
        console.error('Delete user error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500, headers: corsHeaders }
        );
    }
}
